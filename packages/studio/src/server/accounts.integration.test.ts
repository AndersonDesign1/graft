/**
 * Integration: Studio accounts over HTTP, against a live database (opt-in).
 * The first visit creates the owner, the owner invites someone from People,
 * and sessions end when they should. Accounts belong to no branch, so this
 * runs in a throwaway database it creates and drops.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupCode } from "../accounts";
import type { PeopleDto, WorkspaceDto } from "../editor-types";
import { createStudioHandler } from "../handler";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TIMEOUT = 60_000;
const ORIGIN = "https://shop.test";
const secret = "s".repeat(40);

describe.skipIf(!runIntegration)("Studio accounts over HTTP (integration)", () => {
  let admin: DbHandle;
  let handle: DbHandle | undefined;
  const name = `graft_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let handler: ReturnType<typeof createStudioHandler>;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL as string;
    admin = createDb(url);
    try {
      await admin.sql.unsafe(`create database ${name}`);
    } catch {
      return; // this role can't create a database: every test skips
    }
    const scratch = new URL(url);
    scratch.pathname = `/${name}`;
    await runMigrations(scratch.toString());
    handle = createDb(scratch.toString());
    handler = createStudioHandler({
      db: handle.db,
      collections: {},
      contentDir: "/tmp/graft-none",
      uiBasePath: "/studio",
      editors: { secret, accounts: { db: handle.db } },
    });
  }, TIMEOUT);

  afterAll(async () => {
    await handle?.close();
    await admin.sql.unsafe(`drop database if exists ${name} with (force)`);
    await admin.close();
  }, TIMEOUT);

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string } = {},
  ): Promise<{ status: number; json: any; cookie: string }> {
    const response = await handler(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          origin: ORIGIN,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      }),
    );
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((pair) => !pair?.endsWith("="))
      .join("; ");
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null, cookie };
  }

  let owner = "";
  let ben = "";

  it("asks for the owner on the first visit, and wants the setup code off this computer", async (ctx) => {
    if (!handle) return ctx.skip();
    const session = await call("GET", "/api/studio/v1/auth/session");
    expect(session.json).toMatchObject({
      user: null,
      methods: { password: true },
      setup: { needsCode: true },
    });

    const wrong = await call("POST", "/api/studio/v1/auth/setup", {
      body: { email: "ana@shop.test", password: "correct horse battery", code: "nope" },
    });
    expect(wrong.status).toBe(401);
    const short = await call("POST", "/api/studio/v1/auth/setup", {
      body: { email: "ana@shop.test", password: "short", code: setupCode(secret) },
    });
    expect(short.json.error).toBe("INPUT_VALIDATION_FAILED");

    const created = await call("POST", "/api/studio/v1/auth/setup", {
      body: {
        name: "Ana",
        email: "Ana@Shop.test",
        password: "correct horse battery",
        code: setupCode(secret).toLowerCase(),
      },
    });
    expect(created.status).toBe(200);
    expect(created.json.user).toMatchObject({
      email: "ana@shop.test",
      role: "admin",
      via: "account",
    });
    owner = created.cookie;
    expect(owner).toMatch(/^graft_studio=acct_/);

    const again = await call("POST", "/api/studio/v1/auth/setup", {
      body: { email: "eve@x.test", password: "correct horse battery", code: setupCode(secret) },
    });
    expect(again.status).toBe(401);
    expect((await call("GET", "/api/studio/v1/auth/session")).json.setup).toBeNull();
  });

  it("lets the owner into the API, with accounts and people on", async (ctx) => {
    if (!handle) return ctx.skip();
    expect((await call("GET", "/api/studio/v1/people")).status).toBe(401);
    const people = await call("GET", "/api/studio/v1/people", { cookie: owner });
    expect((people.json as PeopleDto).people).toMatchObject([
      { email: "ana@shop.test", role: "admin", owner: true, you: true },
    ]);
  });

  it("signs in with the right password only, and locks after five wrong ones", async (ctx) => {
    if (!handle) return ctx.skip();
    const ok = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "ANA@shop.test", password: "correct horse battery" },
    });
    expect(ok.status).toBe(200);
    const unknown = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "nobody@shop.test", password: "correct horse battery" },
    });
    expect(unknown.status).toBe(401);
    for (let i = 0; i < 5; i += 1) {
      const wrong = await call("POST", "/api/studio/v1/auth/sign-in", {
        body: { email: "ana@shop.test", password: "wrong password!" },
      });
      expect(wrong.status).toBe(401);
    }
    const locked = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "ana@shop.test", password: "correct horse battery" },
    });
    expect(locked.status).toBe(429);
    await handle.sql`update studio_users set locked_until = null`;
  });

  it("invites someone from People, who chooses a password and is signed in", async (ctx) => {
    if (!handle) return ctx.skip();
    const invited = await call("POST", "/api/studio/v1/people/invites", {
      cookie: owner,
      body: { email: "ben@shop.test", name: "Ben", role: "contributor" },
    });
    expect(invited.status).toBe(201);
    const link = new URL(invited.json.url);
    expect(link.pathname).toBe("/studio/");
    const token = link.searchParams.get("invite") ?? "";

    const info = await call("GET", `/api/studio/v1/auth/invite?token=${encodeURIComponent(token)}`);
    expect(info.json).toEqual({
      email: "ben@shop.test",
      name: "Ben",
      role: "contributor",
      reset: false,
    });

    const joined = await call("POST", "/api/studio/v1/auth/invite", {
      body: { token, password: "another long password" },
    });
    expect(joined.json.user).toMatchObject({ email: "ben@shop.test", role: "contributor" });
    ben = joined.cookie;

    const reused = await call("POST", "/api/studio/v1/auth/invite", {
      body: { token, password: "another long password" },
    });
    expect(reused.status).toBe(401);

    const workspace = await call("GET", "/api/studio/v1/workspace", { cookie: ben });
    expect(workspace.json as WorkspaceDto).toMatchObject({
      accounts: true,
      user: { email: "ben@shop.test" },
    });
    const refused = await call("GET", "/api/studio/v1/people", { cookie: ben });
    expect(refused.json).toMatchObject({ details: { required: "studio:people" } });
  });

  it("changes roles, keeps an admin, and ends a removed person's sessions", async (ctx) => {
    if (!handle) return ctx.skip();
    const people = (await call("GET", "/api/studio/v1/people", { cookie: owner }))
      .json as PeopleDto;
    const ana = people.people.find((p) => p.owner);
    const benRow = people.people.find((p) => p.email === "ben@shop.test");
    if (!ana || !benRow) throw new Error("expected Ana and Ben");

    const demote = await call("PUT", `/api/studio/v1/people/${ana.id}`, {
      cookie: owner,
      body: { role: "editor" },
    });
    expect(demote.status).toBe(400);
    const self = await call("DELETE", `/api/studio/v1/people/${ana.id}`, { cookie: owner });
    expect(self.status).toBe(400);
    const bogus = await call("DELETE", "/api/studio/v1/people/not-a-uuid", { cookie: owner });
    expect(bogus.status).toBe(404);

    const promote = await call("PUT", `/api/studio/v1/people/${benRow.id}`, {
      cookie: owner,
      body: { role: "editor" },
    });
    expect(promote.status).toBe(204);
    const session = await call("GET", "/api/studio/v1/auth/session", { cookie: ben });
    expect(session.json.user.role).toBe("editor");

    const reset = await call("POST", `/api/studio/v1/people/${benRow.id}/reset`, {
      cookie: owner,
      body: {},
    });
    expect(reset.status).toBe(201);
    const resetToken = new URL(reset.json.url).searchParams.get("invite") ?? "";
    const info = await call("GET", `/api/studio/v1/auth/invite?token=${resetToken}`);
    expect(info.json).toMatchObject({ email: "ben@shop.test", reset: true });
    const renewed = await call("POST", "/api/studio/v1/auth/invite", {
      body: { token: resetToken, password: "a new password for ben" },
    });
    expect(renewed.json.user).toMatchObject({ role: "editor" });
    expect((await call("GET", "/api/studio/v1/workspace", { cookie: ben })).status).toBe(401);
    ben = renewed.cookie;

    const removed = await call("DELETE", `/api/studio/v1/people/${benRow.id}`, { cookie: owner });
    expect(removed.status).toBe(204);
    expect((await call("GET", "/api/studio/v1/workspace", { cookie: ben })).status).toBe(401);
  });

  it("revokes an invitation, signs out for good, and changes a password", async (ctx) => {
    if (!handle) return ctx.skip();
    const invited = await call("POST", "/api/studio/v1/people/invites", {
      cookie: owner,
      body: { email: "cy@shop.test", role: "viewer" },
    });
    const revoked = await call(
      "DELETE",
      `/api/studio/v1/people/invites/${invited.json.invite.id}`,
      {
        cookie: owner,
      },
    );
    expect(revoked.status).toBe(204);
    const token = new URL(invited.json.url).searchParams.get("invite") ?? "";
    expect((await call("GET", `/api/studio/v1/auth/invite?token=${token}`)).status).toBe(401);

    const second = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "ana@shop.test", password: "correct horse battery" },
    });
    const wrong = await call("POST", "/api/studio/v1/auth/password", {
      cookie: owner,
      body: { current: "not it at all", next: "a brand new password" },
    });
    expect(wrong.status).toBe(401);
    const changed = await call("POST", "/api/studio/v1/auth/password", {
      cookie: owner,
      body: { current: "correct horse battery", next: "a brand new password" },
    });
    expect(changed.status).toBe(204);
    expect((await call("GET", "/api/studio/v1/workspace", { cookie: second.cookie })).status).toBe(
      401,
    );
    expect((await call("GET", "/api/studio/v1/workspace", { cookie: owner })).status).toBe(200);

    const out = await call("POST", "/api/studio/v1/auth/sign-out", { cookie: owner });
    expect(out.status).toBe(204);
    expect((await call("GET", "/api/studio/v1/workspace", { cookie: owner })).status).toBe(401);
  });
});
