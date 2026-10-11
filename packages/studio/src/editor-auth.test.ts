import { describe, expect, it, vi } from "vitest";
import { createStudioHandler } from "./handler";
import {
  SESSION_COOKIE,
  createInviteLink,
  editorAccessFromEnv,
  parseEditorList,
  sign,
  verify,
} from "./session";

const secret = "s".repeat(40);
const base = { db: {} as never, collections: {}, contentDir: "/tmp/graft-none" };
const ORIGIN = "https://shop.test";

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair?.endsWith("="))
    .join("; ");
}

async function signInWithLink(
  handler: ReturnType<typeof createStudioHandler>,
  role: "viewer" | "editor" = "editor",
): Promise<string> {
  const { url } = createInviteLink({
    secret,
    baseUrl: ORIGIN,
    email: "Ana@Shop.test",
    name: "Ana",
    role,
  });
  const response = await handler(new Request(url, { redirect: "manual" }));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/studio/");
  return cookiesFrom(response);
}

describe("session codec", () => {
  it("round-trips, and refuses tampering, expiry and the wrong purpose", () => {
    const token = sign(secret, "session", { id: "ana" }, 1000, 0);
    expect(verify(secret, "session", token, 500)).toEqual({ id: "ana" });
    expect(verify(secret, "session", token, 2000)).toBeNull();
    expect(verify("x".repeat(40), "session", token, 500)).toBeNull();
    expect(verify(secret, "invite", token, 500)).toBeNull();
    const [body, mac] = token.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ p: "session", exp: 9e15, data: { id: "root" } }),
    ).toString("base64url");
    expect(verify(secret, "session", `${forged}.${mac}`, 500)).toBeNull();
    expect(verify(secret, "session", `${body}.`, 500)).toBeNull();
    expect(verify(secret, "session", "garbage", 500)).toBeNull();
  });

  it("parses the editor list and refuses unknown roles", () => {
    expect([...parseEditorList(" Ana@Shop.test=admin, octocat ,ben=contributor")]).toEqual([
      ["ana@shop.test", "admin"],
      ["octocat", "editor"],
      ["ben", "contributor"],
    ]);
    expect(() => parseEditorList("ana=owner")).toThrow(/the role "owner"/);
  });

  it("reads sign-in settings from the environment", () => {
    expect(editorAccessFromEnv({})).toBeUndefined();
    expect(() => editorAccessFromEnv({ GRAFT_STUDIO_SECRET: "short" })).toThrow(/too short/);
    expect(() =>
      editorAccessFromEnv({ GRAFT_STUDIO_SECRET: secret, GRAFT_GITHUB_CLIENT_ID: "id" }),
    ).toThrow(/Only one/);
    expect(
      editorAccessFromEnv({
        GRAFT_STUDIO_SECRET: secret,
        GRAFT_STUDIO_URL: "https://shop.test/",
        GRAFT_GITHUB_CLIENT_ID: "id",
        GRAFT_GITHUB_CLIENT_SECRET: "cs",
      }),
    ).toMatchObject({ publicUrl: "https://shop.test", github: { clientId: "id" } });
  });

  it("refuses an invite for something that is not an email", () => {
    expect(() =>
      createInviteLink({ secret, baseUrl: ORIGIN, email: "ana", role: "editor" }),
    ).toThrow(/not an email/);
  });
});

describe("hosted Studio sign-in", () => {
  const handler = createStudioHandler({ ...base, uiBasePath: "/studio", editors: { secret } });

  it("refuses the API to a signed-out browser but answers who is signed in", async () => {
    const api = await handler(new Request(`${ORIGIN}/api/studio/v1/openapi.json`));
    expect(api.status).toBe(401);
    const session = await handler(new Request(`${ORIGIN}/api/studio/v1/auth/session`));
    expect(await session.json()).toEqual({
      user: null,
      methods: { github: false, invite: true },
    });
  });

  it("signs in with an invite link as a secure, http-only cookie", async () => {
    const { url } = createInviteLink({
      secret,
      baseUrl: ORIGIN,
      email: "ana@shop.test",
      role: "editor",
    });
    const response = await handler(new Request(url, { redirect: "manual" }));
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  it("grants exactly the scopes of the role", async () => {
    const editor = await signInWithLink(handler, "editor");
    const who = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/session`, { headers: { cookie: editor } }),
    );
    expect((await who.json()).user).toMatchObject({
      id: "ana@shop.test",
      name: "Ana",
      role: "editor",
      scopes: ["studio:read", "studio:write", "studio:publish"],
    });
    const read = await handler(
      new Request(`${ORIGIN}/api/studio/v1/openapi.json`, { headers: { cookie: editor } }),
    );
    expect(read.status).toBe(200);

    const viewer = await signInWithLink(handler, "viewer");
    const write = await handler(
      new Request(`${ORIGIN}/api/studio/v1/changes/commit`, {
        method: "POST",
        headers: { cookie: viewer, "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ paths: ["a.mdx"], message: "x" }),
      }),
    );
    expect(write.status).toBe(401);
    expect((await write.json()).message).toContain("studio:write");
  });

  it("keeps bearer credentials working beside sessions", async () => {
    const withBearer = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: { secret },
      authenticate: (request) =>
        request.headers.get("authorization") === "Bearer agent"
          ? { kind: "agent", id: "bot", scopes: ["studio:read"] }
          : null,
    });
    const ok = await withBearer(
      new Request(`${ORIGIN}/api/studio/v1/openapi.json`, {
        headers: { authorization: "Bearer agent" },
      }),
    );
    expect(ok.status).toBe(200);
  });

  it("sends an expired or forged link back to the sign-in screen", async () => {
    const response = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/link?token=nope`, { redirect: "manual" }),
    );
    expect(response.headers.get("location")).toBe("/studio/?signin=link_expired");
    expect(cookiesFrom(response)).toBe("");
  });

  it("signs out by clearing the cookie, and only from its own origin", async () => {
    const cookie = await signInWithLink(handler);
    const foreign = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/sign-out`, {
        method: "POST",
        headers: { cookie, origin: "https://evil.test" },
      }),
    );
    expect(foreign.status).toBe(401);
    const out = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/sign-out`, {
        method: "POST",
        headers: { cookie, origin: ORIGIN },
      }),
    );
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });
});

describe("Sign in with GitHub", () => {
  function githubStub(user: { login: string; name?: string; email?: string | null }) {
    const calls: string[] = [];
    const stub = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "gho" });
      if (url.endsWith("/user")) return Response.json(user);
      if (url.endsWith("/user/emails")) {
        return Response.json([{ email: "octo@shop.test", primary: true, verified: true }]);
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    return { stub, calls };
  }

  async function flow(
    handler: ReturnType<typeof createStudioHandler>,
    returnTo = "/studio/#/collections/products",
  ) {
    const start = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/github?return=${encodeURIComponent(returnTo)}`, {
        redirect: "manual",
      }),
    );
    const authorize = new URL(start.headers.get("location") as string);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/studio/v1/auth/github/callback`,
    );
    const state = authorize.searchParams.get("state");
    return handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/github/callback?code=c&state=${state}`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    );
  }

  it("admits someone on the editor list, with the list's role", async () => {
    const { stub } = githubStub({ login: "Octocat", name: "Mona" });
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        editors: parseEditorList("octocat=admin"),
        github: { clientId: "id", clientSecret: "cs", fetch: stub },
      },
    });
    const done = await flow(handler);
    expect(done.headers.get("location")).toBe("/studio/#/collections/products");
    const who = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/session`, {
        headers: { cookie: cookiesFrom(done) },
      }),
    );
    expect((await who.json()).user).toMatchObject({
      id: "Octocat",
      email: "octo@shop.test",
      role: "admin",
    });
  });

  it("falls back to repository write access when there is no list", async () => {
    const { stub } = githubStub({ login: "dev", email: "dev@shop.test" });
    const permissions: Record<string, string> = { dev: "write", fan: "read" };
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        github: { clientId: "id", clientSecret: "cs", fetch: stub },
        permissionOf: async (login) => permissions[login] ?? "none",
      },
    });
    const done = await flow(handler);
    expect(cookiesFrom(done)).toContain("graft_studio=");

    const { stub: fanStub } = githubStub({ login: "fan" });
    const refused = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        github: { clientId: "id", clientSecret: "cs", fetch: fanStub },
        permissionOf: async (login) => permissions[login] ?? "none",
      },
    });
    // The failure lands on the page the person started from, branch and hash
    // kept, so trying again resumes where they were.
    const denied = await flow(refused, "/studio/?branch=preview#/collections/products");
    expect(denied.headers.get("location")).toBe(
      "/studio/?branch=preview&signin=not_allowed#/collections/products",
    );

    // A failed check is not a "no": the screen says access couldn't be checked.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { stub: devStub } = githubStub({ login: "dev" });
    const broken = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        github: { clientId: "id", clientSecret: "cs", fetch: devStub },
        permissionOf: async () => {
          throw new Error("GitHub would not say (403)");
        },
      },
    });
    const unchecked = await flow(broken);
    expect(unchecked.headers.get("location")).toBe(
      "/studio/?signin=access_unchecked#/collections/products",
    );
    expect(quiet).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it("keeps the return path when GitHub cannot be reached", async () => {
    // The fetch throws, so the error leaves githubCallback; the outer catch
    // used to send the person to Studio's front page.
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: { secret, github: { clientId: "id", clientSecret: "cs", fetch: unreachable } },
    });
    const response = await flow(handler, "/studio/?branch=preview#/collections/products");
    expect(response.headers.get("location")).toBe(
      "/studio/?branch=preview&signin=github_refused#/collections/products",
    );
  });

  it("never redirects off-site after sign-in", async () => {
    const { stub } = githubStub({ login: "octocat" });
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        editors: parseEditorList("octocat"),
        github: { clientId: "id", clientSecret: "cs", fetch: stub },
      },
    });
    for (const target of ["https://evil.test/", "//evil.test", "/\\evil.test"]) {
      const done = await flow(handler, target);
      expect(done.headers.get("location")).toBe("/studio/");
    }
  });

  it("refuses a callback without the matching state", async () => {
    const { stub } = githubStub({ login: "octocat" });
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        editors: parseEditorList("octocat"),
        github: { clientId: "id", clientSecret: "cs", fetch: stub },
      },
    });
    const response = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/github/callback?code=c&state=forged`, {
        redirect: "manual",
      }),
    );
    expect(response.headers.get("location")).toBe("/studio/?signin=expired");
  });
});
