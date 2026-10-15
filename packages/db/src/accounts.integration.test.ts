/**
 * Integration: Studio accounts against a live database (opt-in), in a
 * throwaway database of their own, since accounts belong to no branch.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvite,
  accountForSignIn,
  countAccounts,
  createInvite,
  createOwner,
  createPasswordReset,
  createSession,
  deleteSession,
  disableAccount,
  hasActiveAccount,
  listAccounts,
  openInvites,
  readInvite,
  recordSignIn,
  revokeInvite,
  sessionAccount,
  setAccountRole,
  setPassword,
} from "./accounts";
import type { Database } from "./client";
import { createScratchDatabase, type ScratchDatabase } from "./scratch-database";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TIMEOUT = 60_000;
const later = (ms: number) => new Date(Date.now() + ms);
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!runIntegration)("Studio accounts (live)", () => {
  let scratch: ScratchDatabase | null;
  let db: Database;

  beforeAll(async () => {
    scratch = await createScratchDatabase(process.env.DATABASE_URL as string);
    if (scratch) db = scratch.handle.db;
  }, TIMEOUT);
  afterAll(async () => {
    await scratch?.drop();
  }, TIMEOUT);

  it("creates exactly one owner, however many first visits race", async (ctx) => {
    if (!scratch) return ctx.skip();
    expect(await countAccounts(db)).toBe(0);
    const results = await Promise.all(
      ["a@x.test", "b@x.test", "c@x.test"].map((email) =>
        createOwner(db, { email, name: email, passwordHash: "h" }),
      ),
    );
    const owners = results.filter((r) => r !== null);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ role: "admin", owner: true });
    expect(await countAccounts(db)).toBe(1);
  });

  it("finds an account by email in any case, and locks it after repeated wrong passwords", async (ctx) => {
    if (!scratch) return ctx.skip();
    const [owner] = await listAccounts(db);
    const found = await accountForSignIn(db, owner?.email.toUpperCase() ?? "");
    expect(found?.id).toBe(owner?.id);
    for (let i = 0; i < 3; i += 1) {
      await recordSignIn(db, found?.id ?? "", false, { maxFailures: 3, lockMs: 60_000 });
    }
    expect(
      (await accountForSignIn(db, owner?.email ?? ""))?.lockedUntil?.getTime(),
    ).toBeGreaterThan(Date.now());
    await recordSignIn(db, found?.id ?? "", true, { maxFailures: 3, lockMs: 60_000 });
    expect((await accountForSignIn(db, owner?.email ?? ""))?.lockedUntil).toBeNull();
  });

  it("invites once, replaces an older link, and turns the invitation into an account", async (ctx) => {
    if (!scratch) return ctx.skip();
    const [owner] = await listAccounts(db);
    const first = await createInvite(db, {
      email: "ben@x.test",
      role: "editor",
      tokenHash: "t1",
      invitedById: owner?.id ?? null,
      expiresAt: later(DAY),
    });
    expect(first.ok).toBe(true);
    await createInvite(db, {
      email: "BEN@x.test",
      name: "Ben",
      role: "contributor",
      tokenHash: "t2",
      invitedById: null,
      expiresAt: later(DAY),
    });
    expect(await readInvite(db, "t1")).toBeNull();
    expect((await openInvites(db)).map((i) => i.role)).toEqual(["contributor"]);

    const accepted = await acceptInvite(db, { tokenHash: "t2", passwordHash: "p" });
    expect(accepted).toMatchObject({ ok: true, account: { name: "Ben", role: "contributor" } });
    expect(await acceptInvite(db, { tokenHash: "t2", passwordHash: "p" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await createInvite(db, {
        email: "ben@x.test",
        role: "editor",
        tokenHash: "t3",
        invitedById: null,
        expiresAt: later(DAY),
      }),
    ).toEqual({ ok: false, reason: "has-account" });
    expect(await openInvites(db)).toEqual([]);
  });

  it("refuses an expired or revoked invitation", async (ctx) => {
    if (!scratch) return ctx.skip();
    await createInvite(db, {
      email: "old@x.test",
      role: "viewer",
      tokenHash: "old",
      invitedById: null,
      expiresAt: later(-1000),
    });
    expect(await readInvite(db, "old")).toBeNull();
    const fresh = await createInvite(db, {
      email: "gone@x.test",
      role: "viewer",
      tokenHash: "gone",
      invitedById: null,
      expiresAt: later(DAY),
    });
    if (!fresh.ok) throw new Error("expected an invitation");
    expect(await revokeInvite(db, fresh.invite.id)).toBe(true);
    expect(await revokeInvite(db, fresh.invite.id)).toBe(false);
    expect(await acceptInvite(db, { tokenHash: "gone", passwordHash: "p" })).toMatchObject({
      ok: false,
    });
  });

  it("keeps an admin, ends sessions on removal, and gives a re-invited person their account back", async (ctx) => {
    if (!scratch) return ctx.skip();
    const people = await listAccounts(db);
    const owner = people.find((p) => p.owner);
    const ben = people.find((p) => p.email.toLowerCase() === "ben@x.test");
    if (!owner || !ben) throw new Error("expected the owner and Ben");

    expect(await setAccountRole(db, owner.id, "editor")).toEqual({
      ok: false,
      reason: "last-admin",
    });
    expect(await disableAccount(db, owner.id)).toEqual({ ok: false, reason: "last-admin" });

    await createSession(db, { tokenHash: "ben-session", userId: ben.id, expiresAt: later(DAY) });
    expect((await sessionAccount(db, "ben-session"))?.id).toBe(ben.id);
    expect(await setAccountRole(db, ben.id, "admin")).toEqual({ ok: true });
    expect((await sessionAccount(db, "ben-session"))?.role).toBe("admin");
    expect(await setAccountRole(db, owner.id, "editor")).toEqual({ ok: true });
    expect(await setAccountRole(db, owner.id, "admin")).toEqual({ ok: true });

    expect(await disableAccount(db, ben.id)).toEqual({ ok: true });
    expect(await sessionAccount(db, "ben-session")).toBeNull();
    expect(await disableAccount(db, ben.id)).toEqual({ ok: false, reason: "not-found" });
    expect(await accountForSignIn(db, "ben@x.test")).toBeNull();

    await createInvite(db, {
      email: "ben@x.test",
      role: "viewer",
      tokenHash: "again",
      invitedById: owner.id,
      expiresAt: later(DAY),
    });
    const back = await acceptInvite(db, { tokenHash: "again", passwordHash: "p2" });
    expect(back).toMatchObject({ ok: true, account: { id: ben.id, role: "viewer" } });
  });

  it("resets a forgotten password: the role stays, and every session ends", async (ctx) => {
    if (!scratch) return ctx.skip();
    const ben = (await listAccounts(db)).find((p) => p.email.toLowerCase() === "ben@x.test");
    if (!ben) throw new Error("expected Ben");
    await createSession(db, { tokenHash: "ben-old", userId: ben.id, expiresAt: later(DAY) });
    const reset = await createPasswordReset(db, {
      accountId: ben.id,
      tokenHash: "reset",
      invitedById: null,
      expiresAt: later(DAY),
    });
    expect(reset).toMatchObject({ ok: true, invite: { role: ben.role } });
    expect(await hasActiveAccount(db, "BEN@x.test")).toBe(true);
    const used = await acceptInvite(db, { tokenHash: "reset", passwordHash: "fresh" });
    expect(used).toMatchObject({ ok: true, account: { id: ben.id, role: ben.role } });
    expect(await sessionAccount(db, "ben-old")).toBeNull();
    expect((await accountForSignIn(db, "ben@x.test"))?.passwordHash).toBe("fresh");
    expect(
      await createPasswordReset(db, {
        accountId: "00000000-0000-0000-0000-000000000000",
        tokenHash: "nobody",
        invitedById: null,
        expiresAt: later(DAY),
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("ends a signed-out session, an expired one, and the others after a password change", async (ctx) => {
    if (!scratch) return ctx.skip();
    const owner = (await listAccounts(db)).find((p) => p.owner);
    if (!owner) throw new Error("expected the owner");
    await createSession(db, { tokenHash: "s1", userId: owner.id, expiresAt: later(DAY) });
    await createSession(db, { tokenHash: "s2", userId: owner.id, expiresAt: later(DAY) });
    await createSession(db, { tokenHash: "s3", userId: owner.id, expiresAt: later(-1) });
    expect(await sessionAccount(db, "s3")).toBeNull();
    await deleteSession(db, "s1");
    expect(await sessionAccount(db, "s1")).toBeNull();

    await createSession(db, { tokenHash: "s4", userId: owner.id, expiresAt: later(DAY) });
    await setPassword(db, { id: owner.id, passwordHash: "new", keepSession: "s4" });
    expect(await sessionAccount(db, "s2")).toBeNull();
    expect((await sessionAccount(db, "s4"))?.id).toBe(owner.id);
    expect((await accountForSignIn(db, owner.email))?.passwordHash).toBe("new");
  });
});
