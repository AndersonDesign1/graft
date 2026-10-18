import { createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioHandler } from "./handler";
import { editorAccessFromEnv, parseAutoJoin, parseEditorList } from "./session";

const secret = "s".repeat(40);
const base = { db: {} as never, collections: {}, contentDir: "/tmp/graft-none" };
const ORIGIN = "https://shop.test";
const ISSUER = "https://auth.shop.test/api/auth";
const CALLBACK = `${ORIGIN}/api/studio/v1/auth/oidc/callback`;

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair?.endsWith("="))
    .join("; ");
}

const { privateKey, publicKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };

interface ProviderSettings {
  /** Claims the ID token carries, on top of iss, aud, sub, nonce, iat and exp. */
  claims?: JWTPayload;
  /** What userinfo answers. */
  userinfo?: Record<string, unknown>;
  /** Change the ID token before it is signed. */
  tamper?: (claims: JWTPayload) => JWTPayload;
  /** Sign with the client secret (HS256) instead of the published key. */
  hmac?: boolean;
  metadata?: Record<string, unknown>;
  /** The provider's issuer. Default: a Better Auth at auth.shop.test. */
  issuer?: string;
  /** How the client was registered to send its secret. Default: either. */
  registered?: "client_secret_basic" | "client_secret_post";
}

/**
 * A provider that behaves like a real one: it publishes its metadata and keys,
 * remembers the nonce and PKCE challenge an authorization carried, and only
 * trades the code for tokens when the verifier matches.
 */
function fakeProvider(settings: ProviderSettings = {}) {
  const issuer = settings.issuer ?? ISSUER;
  const seen: {
    tokenRequest?: { headers: Headers; body: URLSearchParams };
    tokenRequests: number;
  } = { tokenRequests: 0 };
  let authorization: URLSearchParams | undefined;
  const stub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        userinfo_endpoint: `${issuer}/oauth2/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        ...settings.metadata,
      });
    }
    if (url === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${issuer}/oauth2/token`) {
      const body = new URLSearchParams(String(init?.body));
      seen.tokenRequest = { headers: new Headers(init?.headers), body };
      seen.tokenRequests += 1;
      const used = seen.tokenRequest.headers.has("authorization")
        ? "client_secret_basic"
        : "client_secret_post";
      if (settings.registered && settings.registered !== used) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      const challenge = createHash("sha256")
        .update(body.get("code_verifier") ?? "")
        .digest("base64url");
      if (!authorization || challenge !== authorization.get("code_challenge")) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const claims = {
        iss: issuer,
        aud: "studio",
        sub: "user-1",
        nonce: authorization.get("nonce") ?? undefined,
        ...settings.claims,
      };
      const final = settings.tamper ? settings.tamper(claims) : claims;
      const jwt = new SignJWT(final).setIssuedAt().setExpirationTime("10m");
      const idToken = settings.hmac
        ? await jwt.setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("cs"))
        : await jwt.setProtectedHeader({ alg: "ES256", kid: "k1" }).sign(privateKey);
      return Response.json({ id_token: idToken, access_token: "at", token_type: "Bearer" });
    }
    if (url === `${issuer}/oauth2/userinfo`) {
      return Response.json(settings.userinfo ?? { sub: "user-1" });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  return {
    stub,
    seen,
    /** The provider's side of the redirect: remember what the browser brought. */
    authorize(location: string): URL {
      const url = new URL(location);
      authorization = url.searchParams;
      return url;
    },
  };
}

function studio(provider: ReturnType<typeof fakeProvider>, editors = "ana@shop.test=admin") {
  return createStudioHandler({
    ...base,
    uiBasePath: "/studio",
    editors: {
      secret,
      editors: parseEditorList(editors),
      oidc: { issuer: ISSUER, clientId: "studio", clientSecret: "cs", fetch: provider.stub },
    },
  });
}

async function flow(
  handler: ReturnType<typeof createStudioHandler>,
  provider: ReturnType<typeof fakeProvider>,
  returnTo = "/studio/?branch=preview#/c/products",
  route: "oidc" | "google" = "oidc",
) {
  const start = await handler(
    new Request(`${ORIGIN}/api/studio/v1/auth/${route}?return=${encodeURIComponent(returnTo)}`, {
      redirect: "manual",
    }),
  );
  expect(start.status).toBe(302);
  const authorize = provider.authorize(start.headers.get("location") as string);
  const state = authorize.searchParams.get("state");
  return {
    authorize,
    done: await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/${route}/callback?code=c&state=${state}`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    ),
    start,
  };
}

async function sessionUser(handler: ReturnType<typeof createStudioHandler>, cookie: string) {
  const who = await handler(
    new Request(`${ORIGIN}/api/studio/v1/auth/session`, { headers: { cookie } }),
  );
  return (await who.json()).user;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sign in with OIDC", () => {
  it("signs in a verified email on the editor list, with the list's role", async () => {
    const provider = fakeProvider({
      claims: { email: "Ana@Shop.test", email_verified: true, name: "Ana" },
    });
    const handler = studio(provider);
    const { authorize, done } = await flow(handler, provider);

    expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "studio",
      redirect_uri: CALLBACK,
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    expect(authorize.searchParams.get("nonce")).toBeTruthy();
    // The client secret goes in an Authorization header, the OpenID default.
    expect(provider.seen.tokenRequest?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("studio:cs").toString("base64")}`,
    );
    expect(provider.seen.tokenRequest?.body.get("client_secret")).toBeNull();

    expect(done.headers.get("location")).toBe("/studio/?branch=preview#/c/products");
    expect(await sessionUser(handler, cookiesFrom(done))).toMatchObject({
      id: "ana@shop.test",
      email: "ana@shop.test",
      name: "Ana",
      role: "admin",
      via: "oidc",
    });
  });

  it("says on the sign-in screen that OIDC is on, and under what name", async () => {
    const provider = fakeProvider();
    const named = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        oidc: { issuer: ISSUER, clientId: "studio", clientSecret: "cs", name: "Acme" },
      },
    });
    const response = await named(new Request(`${ORIGIN}/api/studio/v1/auth/session`));
    expect((await response.json()).methods).toMatchObject({ oidc: { name: "Acme" } });
    const plain = await studio(provider)(new Request(`${ORIGIN}/api/studio/v1/auth/session`));
    expect((await plain.json()).methods).toMatchObject({ oidc: { name: null } });
  });

  it("refuses an email the provider hasn't verified, and one nobody let in", async () => {
    const unverified = fakeProvider({ claims: { email: "ana@shop.test", email_verified: false } });
    const { done } = await flow(studio(unverified), unverified);
    expect(done.headers.get("location")).toBe(
      "/studio/?branch=preview&signin=email_unverified#/c/products",
    );
    expect(cookiesFrom(done)).not.toContain("graft_studio=");

    const stranger = fakeProvider({ claims: { email: "eve@else.test", email_verified: true } });
    const { done: refused } = await flow(studio(stranger), stranger);
    expect(refused.headers.get("location")).toBe(
      "/studio/?branch=preview&signin=oidc_not_allowed#/c/products",
    );
  });

  it("reads the email from userinfo when the ID token leaves it out", async () => {
    const provider = fakeProvider({
      userinfo: { sub: "user-1", email: "ana@shop.test", email_verified: "true" },
    });
    const handler = studio(provider);
    const { done } = await flow(handler, provider);
    expect(await sessionUser(handler, cookiesFrom(done))).toMatchObject({ id: "ana@shop.test" });

    // Userinfo about someone else is ignored.
    const other = fakeProvider({
      userinfo: { sub: "user-2", email: "ana@shop.test", email_verified: true },
    });
    const { done: refused } = await flow(studio(other), other);
    expect(refused.headers.get("location")).toContain("signin=email_unverified");
  });

  it("accepts an ID token signed with the client secret", async () => {
    const provider = fakeProvider({
      hmac: true,
      claims: { email: "ana@shop.test", email_verified: true },
      // A provider that takes the secret only in the POST body, and has no
      // keys to publish (Better Auth with its JWT plugin off).
      metadata: {
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        jwks_uri: undefined,
      },
    });
    const handler = studio(provider);
    const { done } = await flow(handler, provider);
    expect(provider.seen.tokenRequest?.body.get("client_secret")).toBe("cs");
    expect(provider.seen.tokenRequest?.headers.get("authorization")).toBeNull();
    expect(await sessionUser(handler, cookiesFrom(done))).toMatchObject({ role: "admin" });
  });

  it("sends the secret in the POST body when the client was registered that way", async () => {
    // Better Auth lists both ways, and takes only the one the client was registered with.
    const provider = fakeProvider({
      claims: { email: "ana@shop.test", email_verified: true },
      metadata: {
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      },
      registered: "client_secret_post",
    });
    const handler = studio(provider);
    const { done } = await flow(handler, provider);
    expect(provider.seen.tokenRequests).toBe(2);
    expect(provider.seen.tokenRequest?.body.get("client_secret")).toBe("cs");
    expect(await sessionUser(handler, cookiesFrom(done))).toMatchObject({ role: "admin" });

    // Without the POST body on the list, Basic is all there is.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const basicOnly = fakeProvider({
      claims: { email: "ana@shop.test", email_verified: true },
      registered: "client_secret_post",
    });
    const { done: refused } = await flow(studio(basicOnly), basicOnly);
    expect(basicOnly.seen.tokenRequests).toBe(1);
    expect(refused.headers.get("location")).toContain("signin=oidc_refused");
    expect(String(quiet.mock.calls[0]?.[1])).toContain("401 (invalid_client)");
  });

  it("doesn't retry a code the provider refused", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = fakeProvider({
      metadata: {
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      },
    });
    const handler = studio(provider);
    const start = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
    );
    // No authorization was recorded, so the provider answers invalid_grant.
    const state = new URL(start.headers.get("location") as string).searchParams.get("state");
    const done = await handler(
      new Request(`${CALLBACK}?code=used&state=${state}`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    );
    expect(provider.seen.tokenRequests).toBe(1);
    expect(done.headers.get("location")).toBe("/studio/?signin=oidc_refused");
    expect(String(quiet.mock.calls[0]?.[1])).toContain("400 (invalid_grant)");
  });

  it.each([
    ["another nonce", (claims: JWTPayload) => ({ ...claims, nonce: "replayed" })],
    ["another audience", (claims: JWTPayload) => ({ ...claims, aud: "someone-else" })],
    ["another issuer", (claims: JWTPayload) => ({ ...claims, iss: "https://evil.test" })],
    [
      "several audiences and no azp",
      (claims: JWTPayload) => ({ ...claims, aud: ["studio", "other"] }),
    ],
  ])("refuses an ID token with %s", async (_label, tamper) => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = fakeProvider({
      claims: { email: "ana@shop.test", email_verified: true },
      tamper,
    });
    const { done } = await flow(studio(provider), provider);
    expect(done.headers.get("location")).toBe(
      "/studio/?branch=preview&signin=oidc_refused#/c/products",
    );
    expect(cookiesFrom(done)).not.toContain("graft_studio=");
    expect(quiet).toHaveBeenCalledOnce();
  });

  it("refuses an ID token signed with a key the provider didn't publish", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const forger = await generateKeyPair("ES256");
    const provider = fakeProvider({ claims: { email: "ana@shop.test", email_verified: true } });
    const handler = studio(provider);
    const start = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
    );
    const authorize = provider.authorize(start.headers.get("location") as string);
    const forged = await new SignJWT({
      iss: ISSUER,
      aud: "studio",
      sub: "user-1",
      email: "ana@shop.test",
      email_verified: true,
      nonce: authorize.searchParams.get("nonce") ?? "",
    })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(forger.privateKey);
    const forging = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith("/oauth2/token")
        ? Response.json({ id_token: forged })
        : provider.stub(input, init)) as typeof fetch;
    const forgedStudio = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        editors: parseEditorList("ana@shop.test=admin"),
        oidc: { issuer: ISSUER, clientId: "studio", clientSecret: "cs", fetch: forging },
      },
    });
    const done = await forgedStudio(
      new Request(`${CALLBACK}?code=c&state=${authorize.searchParams.get("state")}`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    );
    expect(done.headers.get("location")).toBe("/studio/?signin=oidc_refused");
    expect(quiet).toHaveBeenCalledOnce();
  });

  it("refuses a callback that doesn't match the sign-in it started", async () => {
    const provider = fakeProvider({ claims: { email: "ana@shop.test", email_verified: true } });
    const handler = studio(provider);
    const start = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
    );
    const wrongState = await handler(
      new Request(`${CALLBACK}?code=c&state=forged`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    );
    expect(wrongState.headers.get("location")).toBe("/studio/?signin=expired");
    const noCookie = await handler(
      new Request(`${CALLBACK}?code=c&state=x`, { redirect: "manual" }),
    );
    expect(noCookie.headers.get("location")).toBe("/studio/?signin=expired");

    // The person said no at the provider: it sends back an error, no code.
    provider.authorize(start.headers.get("location") as string);
    const state = new URL(start.headers.get("location") as string).searchParams.get("state");
    const declined = await handler(
      new Request(`${CALLBACK}?error=access_denied&state=${state}`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    );
    expect(declined.headers.get("location")).toBe("/studio/?signin=oidc_refused");
  });

  it("refuses a signed ID token when the provider publishes no keys", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = fakeProvider({
      claims: { email: "ana@shop.test", email_verified: true },
      metadata: { jwks_uri: undefined },
    });
    const { done } = await flow(studio(provider), provider);
    expect(done.headers.get("location")).toContain("signin=oidc_refused");
    expect(String(quiet.mock.calls[0]?.[1])).toContain("publishes no jwks_uri");
  });

  it("refuses a provider whose metadata names another issuer", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = fakeProvider({ metadata: { issuer: "https://evil.test" } });
    const start = await studio(provider)(
      new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
    );
    expect(start.headers.get("location")).toBe("/studio/?signin=oidc_refused");
    expect(String(quiet.mock.calls[0]?.[1])).toContain('names the issuer "https://evil.test"');
  });

  it("is off unless it was set up", async () => {
    const handler = createStudioHandler({ ...base, uiBasePath: "/studio", editors: { secret } });
    const start = await handler(
      new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
    );
    expect(start.headers.get("location")).toBe("/studio/?signin=oidc_off");
    const session = await handler(new Request(`${ORIGIN}/api/studio/v1/auth/session`));
    expect((await session.json()).methods.oidc).toBeNull();
  });
});

describe("Sign in with Google", () => {
  const GOOGLE = "https://accounts.google.com";

  function google(provider: ReturnType<typeof fakeProvider>, editors = "ana@shop.test=editor") {
    return createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        editors: parseEditorList(editors),
        google: { clientId: "studio", clientSecret: "cs", fetch: provider.stub },
      },
    });
  }

  it("signs in through Google, whose ID tokens may drop the scheme from the issuer", async () => {
    const provider = fakeProvider({
      issuer: GOOGLE,
      claims: { iss: "accounts.google.com", email: "ana@shop.test", email_verified: true },
    });
    const handler = google(provider);
    const session = await handler(new Request(`${ORIGIN}/api/studio/v1/auth/session`));
    expect((await session.json()).methods).toMatchObject({ google: true, oidc: null });

    const { authorize, done } = await flow(handler, provider, "/studio/", "google");
    expect(authorize.origin).toBe(GOOGLE);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/studio/v1/auth/google/callback`,
    );
    expect(done.headers.get("location")).toBe("/studio/");
    expect(await sessionUser(handler, cookiesFrom(done))).toMatchObject({
      id: "ana@shop.test",
      role: "editor",
      via: "google",
      password: false,
    });
  });

  it("says Google, not single sign-on, when it refuses", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const stranger = fakeProvider({
      issuer: GOOGLE,
      claims: { email: "eve@else.test", email_verified: true },
    });
    const { done } = await flow(google(stranger), stranger, "/studio/", "google");
    expect(done.headers.get("location")).toBe("/studio/?signin=google_not_allowed");

    const forged = fakeProvider({
      issuer: GOOGLE,
      claims: { email: "ana@shop.test", email_verified: true },
      tamper: (claims) => ({ ...claims, aud: "another-app" }),
    });
    const { done: refused } = await flow(google(forged), forged, "/studio/", "google");
    expect(refused.headers.get("location")).toBe("/studio/?signin=google_refused");
    expect(String(quiet.mock.calls[0]?.[0])).toContain("Google sign-in failed");
  });

  it("won't finish a Google sign-in with another provider's state", async () => {
    const provider = fakeProvider({ claims: { email: "ana@shop.test", email_verified: true } });
    const both = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      editors: {
        secret,
        editors: parseEditorList("ana@shop.test"),
        google: { clientId: "studio", clientSecret: "cs", fetch: provider.stub },
        oidc: { issuer: ISSUER, clientId: "studio", clientSecret: "cs", fetch: provider.stub },
      },
    });
    const start = await both(
      new Request(`${ORIGIN}/api/studio/v1/auth/oidc`, { redirect: "manual" }),
    );
    const state = new URL(start.headers.get("location") as string).searchParams.get("state");
    const crossed = await both(
      new Request(`${ORIGIN}/api/studio/v1/auth/google/callback?code=c&state=${state}`, {
        redirect: "manual",
        headers: { cookie: cookiesFrom(start) },
      }),
    );
    expect(crossed.headers.get("location")).toBe("/studio/?signin=expired");
  });
});

describe("Auto-join by email domain", () => {
  it("reads domains with an optional role, contributor by default", () => {
    expect(parseAutoJoin(" shop.test=editor, @Agency.Example ")).toEqual([
      { domain: "shop.test", role: "editor" },
      { domain: "agency.example", role: "contributor" },
    ]);
    expect(parseAutoJoin(undefined)).toEqual([]);
    expect(
      editorAccessFromEnv({ GRAFT_STUDIO_SECRET: secret, GRAFT_STUDIO_AUTO_JOIN: "shop.test" })
        ?.autoJoin,
    ).toEqual([{ domain: "shop.test", role: "contributor" }]);
  });

  it("refuses admin, open mail providers and things that aren't domains", () => {
    const refusal = (raw: string) => {
      try {
        parseAutoJoin(raw);
      } catch (error) {
        const { message, fix } = error as { message: string; fix: string };
        return `${message} ${fix}`;
      }
      return "accepted";
    };
    expect(refusal("shop.test=admin")).toMatch(/the role "admin".*Nobody joins as an admin/);
    expect(refusal("gmail.com")).toMatch(/anyone could join/);
    expect(refusal("shop.test=owner")).toMatch(/viewer, contributor and editor/);
    expect(refusal("localhost")).toMatch(/isn't an email domain/);
    expect(refusal("ana@shop.test")).toMatch(/isn't an email domain/);
  });

  it("without accounts, admits a verified email at the domain with its role", async () => {
    const handler = (provider: ReturnType<typeof fakeProvider>) =>
      createStudioHandler({
        ...base,
        uiBasePath: "/studio",
        editors: {
          secret,
          autoJoin: parseAutoJoin("shop.test=viewer"),
          oidc: { issuer: ISSUER, clientId: "studio", clientSecret: "cs", fetch: provider.stub },
        },
      });
    const colleague = fakeProvider({ claims: { email: "Zoe@Shop.test", email_verified: true } });
    const joined = handler(colleague);
    const { done } = await flow(joined, colleague);
    expect(await sessionUser(joined, cookiesFrom(done))).toMatchObject({
      id: "zoe@shop.test",
      role: "viewer",
      via: "oidc",
    });

    // Another domain, or the right one unverified, stays out.
    const outsider = fakeProvider({
      claims: { email: "zoe@shop.test.evil", email_verified: true },
    });
    expect((await flow(handler(outsider), outsider)).done.headers.get("location")).toContain(
      "signin=oidc_not_allowed",
    );
    const unverified = fakeProvider({ claims: { email: "zoe@shop.test", email_verified: false } });
    expect((await flow(handler(unverified), unverified)).done.headers.get("location")).toContain(
      "signin=email_unverified",
    );
  });

  it("without accounts, admits a GitHub user by a verified address at the domain", async () => {
    const github = (emails: { email: string; primary: boolean; verified: boolean }[]) =>
      (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "t" });
        if (url.endsWith("/user")) return Response.json({ login: "zoe-codes" });
        if (url.endsWith("/user/emails")) return Response.json(emails);
        return new Response("no", { status: 404 });
      }) as typeof fetch;
    async function signIn(emails: { email: string; primary: boolean; verified: boolean }[]) {
      const handler = createStudioHandler({
        ...base,
        uiBasePath: "/studio",
        editors: {
          secret,
          autoJoin: parseAutoJoin("shop.test=editor"),
          github: { clientId: "id", clientSecret: "cs", fetch: github(emails) },
        },
      });
      const start = await handler(
        new Request(`${ORIGIN}/api/studio/v1/auth/github`, { redirect: "manual" }),
      );
      const state = new URL(start.headers.get("location") as string).searchParams.get("state");
      const done = await handler(
        new Request(`${ORIGIN}/api/studio/v1/auth/github/callback?code=c&state=${state}`, {
          redirect: "manual",
          headers: { cookie: cookiesFrom(start) },
        }),
      );
      return { handler, done };
    }
    const { handler, done } = await signIn([
      { email: "zoe@home.test", primary: true, verified: true },
      { email: "zoe@shop.test", primary: false, verified: true },
    ]);
    expect(await sessionUser(handler, cookiesFrom(done))).toMatchObject({
      id: "zoe-codes",
      email: "zoe@shop.test",
      role: "editor",
      via: "github",
    });
    const { done: refused } = await signIn([
      { email: "zoe@home.test", primary: true, verified: true },
      { email: "zoe@shop.test", primary: false, verified: false },
    ]);
    expect(refused.headers.get("location")).toBe("/studio/?signin=not_allowed");
  });
});

describe("OIDC settings from the environment", () => {
  const env = {
    GRAFT_STUDIO_SECRET: secret,
    GRAFT_OIDC_ISSUER: ISSUER,
    GRAFT_OIDC_CLIENT_ID: "studio",
    GRAFT_OIDC_CLIENT_SECRET: "cs",
  };

  it("reads all three, and the provider's name", () => {
    expect(editorAccessFromEnv({ ...env, GRAFT_OIDC_NAME: " Acme " })?.oidc).toEqual({
      issuer: ISSUER,
      clientId: "studio",
      clientSecret: "cs",
      name: "Acme",
    });
    expect(editorAccessFromEnv({ GRAFT_STUDIO_SECRET: secret })?.oidc).toBeUndefined();
  });

  it("reads Google's client, both halves or neither", () => {
    expect(
      editorAccessFromEnv({
        GRAFT_STUDIO_SECRET: secret,
        GRAFT_GOOGLE_CLIENT_ID: "g-id",
        GRAFT_GOOGLE_CLIENT_SECRET: "g-secret",
      })?.google,
    ).toEqual({ clientId: "g-id", clientSecret: "g-secret" });
    expect(() =>
      editorAccessFromEnv({ GRAFT_STUDIO_SECRET: secret, GRAFT_GOOGLE_CLIENT_ID: "g-id" }),
    ).toThrow("Only one of GRAFT_GOOGLE_CLIENT_ID and GRAFT_GOOGLE_CLIENT_SECRET is set.");
  });

  it("refuses half a setup, naming what is missing", () => {
    expect(() =>
      editorAccessFromEnv({ ...env, GRAFT_OIDC_CLIENT_SECRET: "", GRAFT_OIDC_CLIENT_ID: " " }),
    ).toThrow("GRAFT_OIDC_CLIENT_ID and GRAFT_OIDC_CLIENT_SECRET are missing");
  });

  it("refuses an issuer that isn't https, except on this computer", () => {
    expect(() =>
      editorAccessFromEnv({ ...env, GRAFT_OIDC_ISSUER: "http://auth.shop.test" }),
    ).toThrow(/isn't an https URL/);
    expect(() => editorAccessFromEnv({ ...env, GRAFT_OIDC_ISSUER: "auth.shop.test" })).toThrow(
      /isn't an https URL/,
    );
    expect(
      editorAccessFromEnv({ ...env, GRAFT_OIDC_ISSUER: "http://localhost:3000/api/auth" })?.oidc
        ?.issuer,
    ).toBe("http://localhost:3000/api/auth");
  });
});
