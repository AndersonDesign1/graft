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
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupCode } from "../accounts";
import type { PeopleDto, WorkspaceDto } from "../editor-types";
import { createStudioHandler } from "../handler";
import { parseAutoJoin } from "../session";

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
    } catch (error) {
      // Locally, a role without CREATE DATABASE skips these tests. In CI every
      // test here would then report "skipped" behind a green check, so a
      // missing grant fails the run instead.
      if (process.env.CI) throw error;
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

  it("signs someone in with OIDC as their account, and not once they're removed", async (ctx) => {
    if (!handle) return ctx.skip();
    const issuer = "https://auth.shop.test/api/auth";
    let email = "ANA@shop.test";
    let nonce = "";
    // A provider that signs ID tokens with the client secret, as Better
    // Auth's does when its JWT plugin is off.
    const provider = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      const idToken = await new SignJWT({ email, email_verified: true, nonce })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(issuer)
        .setAudience("studio")
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(new TextEncoder().encode("cs"));
      return Response.json({ id_token: idToken });
    }) as typeof fetch;
    const sso = createStudioHandler({
      db: handle.db,
      collections: {},
      contentDir: "/tmp/graft-none",
      uiBasePath: "/studio",
      editors: {
        secret,
        accounts: { db: handle.db },
        oidc: { issuer, clientId: "studio", clientSecret: "cs", fetch: provider },
      },
    });
    async function signIn(): Promise<Response> {
      const start = await sso(
        new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
      );
      const authorize = new URL(start.headers.get("location") ?? "");
      nonce = authorize.searchParams.get("nonce") ?? "";
      const state = authorize.searchParams.get("state");
      const cookie = start.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      return sso(
        new Request(`${ORIGIN}/api/studio/v1/auth/oidc/callback?code=c&state=${state}`, {
          redirect: "manual",
          headers: { cookie },
        }),
      );
    }

    const ana = await signIn();
    expect(ana.headers.get("location")).toBe("/studio/");
    const session = ana.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c?.startsWith("graft_studio=acct_"));
    if (!session) throw new Error("expected an account session cookie");
    const who = await call("GET", "/api/studio/v1/auth/session", { cookie: session });
    expect(who.json.user).toMatchObject({
      email: "ana@shop.test",
      role: "admin",
      via: "account",
      password: true,
    });
    expect((await call("GET", "/api/studio/v1/people", { cookie: session })).status).toBe(200);

    // Inviting someone from People is all single sign-on needs: their first
    // sign-in uses the invitation, with no link and no password.
    const invited = await call("POST", "/api/studio/v1/people/invites", {
      cookie: session,
      body: { email: "dee@shop.test", role: "viewer" },
    });
    expect(invited.status).toBe(201);
    email = "dee@shop.test";
    const dee = await signIn();
    expect(dee.headers.get("location")).toBe("/studio/");
    const deeSession = dee.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c?.startsWith("graft_studio=acct_"));
    const deeWho = await call("GET", "/api/studio/v1/auth/session", { cookie: deeSession });
    // No password, so Settings has none to change.
    expect(deeWho.json.user).toMatchObject({
      email: "dee@shop.test",
      role: "viewer",
      password: false,
    });
    const team = (await call("GET", "/api/studio/v1/people", { cookie: session }))
      .json as PeopleDto;
    expect(team.people.map((p) => p.email)).toContain("dee@shop.test");
    expect(team.invites.map((i) => i.email)).not.toContain("dee@shop.test");
    // The account has no password: password sign-in stays refused.
    const noPassword = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "dee@shop.test", password: "none" },
    });
    expect(noPassword.status).toBe(401);
    // A reset link for someone who can already sign in still needs its link.
    const deeRow = team.people.find((p) => p.email === "dee@shop.test");
    await call("POST", `/api/studio/v1/people/${deeRow?.id}/reset`, { cookie: session, body: {} });
    await signIn();
    const after = (await call("GET", "/api/studio/v1/people", { cookie: session }))
      .json as PeopleDto;
    expect(after.invites.map((i) => i.email)).toContain("dee@shop.test");
    email = "ANA@shop.test";

    // It is the account's own session row, so signing out ends it for good.
    await call("POST", "/api/studio/v1/auth/sign-out", { cookie: session });
    expect((await call("GET", "/api/studio/v1/workspace", { cookie: session })).status).toBe(401);

    // Ben was removed above: the provider still vouches for him, Studio doesn't.
    email = "ben@shop.test";
    const ben = await signIn();
    expect(ben.headers.get("location")).toBe("/studio/?signin=oidc_not_allowed");
  });

  it("signs someone in with GitHub as their account or their invitation", async (ctx) => {
    if (!handle) return ctx.skip();
    const admin = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "ana@shop.test", password: "a brand new password" },
    });
    expect(admin.status).toBe(200);
    for (const email of ["frank@shop.test", "gil@shop.test"]) {
      const invited = await call("POST", "/api/studio/v1/people/invites", {
        cookie: admin.cookie,
        body: { email, role: "contributor" },
      });
      expect(invited.status).toBe(201);
    }
    // Frank's invited address is a second, verified one on his GitHub account;
    // Gil's is on his account too, but unverified, so it can't stand for him.
    const github = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "t" });
      if (url.endsWith("/user")) return Response.json({ login: "frank-codes", name: "Frank" });
      if (url.endsWith("/user/emails")) {
        return Response.json([
          { email: "frank@home.test", primary: true, verified: true },
          { email: "Frank@Shop.test", primary: false, verified: true },
          { email: "gil@shop.test", primary: false, verified: false },
        ]);
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const viaGitHub = createStudioHandler({
      db: handle.db,
      collections: {},
      contentDir: "/tmp/graft-none",
      uiBasePath: "/studio",
      editors: {
        secret,
        accounts: { db: handle.db },
        github: { clientId: "id", clientSecret: "cs", fetch: github },
      },
    });
    async function signIn(): Promise<Response> {
      const start = await viaGitHub(
        new Request(`${ORIGIN}/api/studio/v1/auth/github`, { redirect: "manual" }),
      );
      const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
      const cookie = start.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      return viaGitHub(
        new Request(`${ORIGIN}/api/studio/v1/auth/github/callback?code=c&state=${state}`, {
          redirect: "manual",
          headers: { cookie },
        }),
      );
    }

    const frank = await signIn();
    expect(frank.headers.get("location")).toBe("/studio/");
    const session = frank.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c?.startsWith("graft_studio=acct_"));
    const who = await call("GET", "/api/studio/v1/auth/session", { cookie: session });
    expect(who.json.user).toMatchObject({
      email: "frank@shop.test",
      name: "Frank",
      role: "contributor",
      via: "account",
      password: false,
    });
    // Signing in again finds the account the invitation made.
    expect((await signIn()).headers.get("location")).toBe("/studio/");
    const team = (await call("GET", "/api/studio/v1/people", { cookie: admin.cookie }))
      .json as PeopleDto;
    const open = team.invites.map((i) => i.email);
    expect(open).not.toContain("frank@shop.test");
    expect(open).toContain("gil@shop.test");
  });

  it("lets a domain join on its own, as accounts People can change or remove", async (ctx) => {
    if (!handle) return ctx.skip();
    const issuer = "https://auth.shop.test/api/auth";
    let email = "hal@corp.test";
    let nonce = "";
    const provider = (async (input: string | URL | Request) => {
      if (String(input).endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
        });
      }
      const idToken = await new SignJWT({ email, email_verified: true, nonce, name: "Hal" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(issuer)
        .setAudience("studio")
        .setSubject(email)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(new TextEncoder().encode("cs"));
      return Response.json({ id_token: idToken });
    }) as typeof fetch;
    const joining = createStudioHandler({
      db: handle.db,
      collections: {},
      contentDir: "/tmp/graft-none",
      uiBasePath: "/studio",
      editors: {
        secret,
        accounts: { db: handle.db },
        autoJoin: parseAutoJoin("corp.test=editor"),
        oidc: { issuer, clientId: "studio", clientSecret: "cs", fetch: provider },
      },
    });
    async function signIn(): Promise<Response> {
      const start = await joining(
        new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
      );
      const authorize = new URL(start.headers.get("location") ?? "");
      nonce = authorize.searchParams.get("nonce") ?? "";
      const cookie = start.headers.getSetCookie()[0]?.split(";")[0] ?? "";
      return joining(
        new Request(
          `${ORIGIN}/api/studio/v1/auth/oidc/callback?code=c&state=${authorize.searchParams.get("state")}`,
          { redirect: "manual", headers: { cookie } },
        ),
      );
    }
    const session = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .find((c) => c?.startsWith("graft_studio=acct_"));
    const admin = await call("POST", "/api/studio/v1/auth/sign-in", {
      body: { email: "ana@shop.test", password: "a brand new password" },
    });
    const peopleAs = async (cookie: string | undefined) =>
      (
        await joining(
          new Request(`${ORIGIN}/api/studio/v1/people`, { headers: { cookie: cookie ?? "" } }),
        )
      ).json() as Promise<PeopleDto>;

    const hal = await signIn();
    expect(hal.headers.get("location")).toBe("/studio/");
    const who = await call("GET", "/api/studio/v1/auth/session", { cookie: session(hal) });
    expect(who.json.user).toMatchObject({
      email: "hal@corp.test",
      name: "Hal",
      role: "editor",
      via: "account",
      password: false,
    });
    const team = await peopleAs(admin.cookie);
    expect(team.autoJoin).toEqual([{ domain: "corp.test", role: "editor" }]);
    const halRow = team.people.find((p) => p.email === "hal@corp.test");
    expect(halRow).toMatchObject({ role: "editor", owner: false });

    // Removed in People: Hal stays out, even though the domain still joins.
    const removed = await call("DELETE", `/api/studio/v1/people/${halRow?.id}`, {
      cookie: admin.cookie,
    });
    expect(removed.status).toBe(204);
    expect((await signIn()).headers.get("location")).toBe("/studio/?signin=oidc_not_allowed");

    // Another domain doesn't join.
    email = "ivy@elsewhere.test";
    expect((await signIn()).headers.get("location")).toBe("/studio/?signin=oidc_not_allowed");
  });
});
