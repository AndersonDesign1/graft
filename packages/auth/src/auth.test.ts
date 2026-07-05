import { GraftError } from "@graft/contracts";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { betterAuthIssuer, createOidcVerifier, type TrustedIssuer } from "./oidc";
import { createActorResolver } from "./resolver";
import { requireScopes } from "./scopes";

const ISSUER = "https://issuer.test";
const AUDIENCE = "https://api.test";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test" }] };
});

interface MintOptions {
  issuer?: string;
  audience?: string;
  subject?: string;
  expiresIn?: string;
  claims?: Record<string, unknown>;
}

async function mint(options: MintOptions = {}): Promise<string> {
  return new SignJWT(options.claims ?? {})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject(options.subject ?? "agent-1")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(privateKey);
}

function requestWith(authorization?: string): Request {
  return new Request("https://api.test/fn/x", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

// Inline-JWKS issuer config; built per call because keys exist only after beforeAll.
function issuerWithInlineJwks(overrides: Partial<TrustedIssuer> = {}): TrustedIssuer {
  return { issuer: ISSUER, jwks, audience: AUDIENCE, ...overrides };
}

async function expectTokenInvalid(
  promise: Promise<unknown>,
  reasonPart: string,
): Promise<GraftError> {
  const err = await promise.then(
    () => {
      throw new Error("expected TOKEN_INVALID, got success");
    },
    (e: unknown) => e as GraftError,
  );
  expect(err).toBeInstanceOf(GraftError);
  expect(err.code).toBe("TOKEN_INVALID");
  expect(String(err.details?.reason ?? err.message)).toContain(reasonPart);
  return err;
}

describe("createActorResolver", () => {
  it("resolves anonymous when no Authorization header is sent", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    await expect(resolve(requestWith())).resolves.toEqual({ kind: "anonymous" });
  });

  it("resolves anonymous for a non-Bearer scheme (not ours to judge)", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    await expect(resolve(requestWith("Basic dXNlcjpwdw=="))).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("resolves a dev token to its configured actor", async () => {
    const resolve = createActorResolver({
      devTokens: { "dev-secret": { kind: "human", id: "owner", scopes: ["submissions:read"] } },
    });
    await expect(resolve(requestWith("Bearer dev-secret"))).resolves.toEqual({
      kind: "human",
      id: "owner",
      scopes: ["submissions:read"],
    });
  });

  it("never accepts an empty-string dev token (unset env var safety)", async () => {
    const resolve = createActorResolver({
      devTokens: { "": { kind: "human", id: "owner" } },
    });
    // "Bearer " with empty token doesn't even match the Bearer regex → anonymous
    await expect(resolve(requestWith("Bearer "))).resolves.toEqual({ kind: "anonymous" });
  });

  it("verifies a JWT from a trusted issuer into an agent actor with scopes", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    const token = await mint({ claims: { scope: "content:write submissions:read" } });
    await expect(resolve(requestWith(`Bearer ${token}`))).resolves.toEqual({
      kind: "agent",
      id: "agent-1",
      scopes: ["content:write", "submissions:read"],
    });
  });

  it("honors actorKind and array scopes claims", async () => {
    const resolve = createActorResolver({
      issuers: [issuerWithInlineJwks({ actorKind: "human" })],
    });
    const token = await mint({ subject: "user-9", claims: { scopes: ["a", "b"] } });
    await expect(resolve(requestWith(`Bearer ${token}`))).resolves.toEqual({
      kind: "human",
      id: "user-9",
      scopes: ["a", "b"],
    });
  });

  it("reads a custom scopesClaim", async () => {
    const resolve = createActorResolver({
      issuers: [issuerWithInlineJwks({ scopesClaim: "capabilities" })],
    });
    const token = await mint({ claims: { capabilities: ["x"], scope: "ignored" } });
    const actor = await resolve(requestWith(`Bearer ${token}`));
    expect(actor.scopes).toEqual(["x"]);
  });

  it("rejects an expired token with TOKEN_INVALID", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    const token = await mint({ expiresIn: "-1m" });
    await expectTokenInvalid(resolve(requestWith(`Bearer ${token}`)), "ERR_JWT_EXPIRED");
  });

  it("rejects an untrusted issuer and names the trusted ones", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    const token = await mint({ issuer: "https://evil.test" });
    const err = await expectTokenInvalid(resolve(requestWith(`Bearer ${token}`)), "not trusted");
    expect(err.details?.trustedIssuers).toEqual([ISSUER]);
  });

  it("rejects a wrong audience with TOKEN_INVALID", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    const token = await mint({ audience: "https://other.test" });
    await expectTokenInvalid(resolve(requestWith(`Bearer ${token}`)), "ERR_JWT_CLAIM");
  });

  it("rejects a garbage token with TOKEN_INVALID", async () => {
    const resolve = createActorResolver({ issuers: [issuerWithInlineJwks()] });
    await expectTokenInvalid(resolve(requestWith("Bearer not-a-jwt")), "not a decodable JWT");
  });

  it("rejects any bearer token when nothing is configured to accept one", async () => {
    const resolve = createActorResolver();
    const err = await resolve(requestWith("Bearer whatever")).then(
      () => {
        throw new Error("expected TOKEN_INVALID");
      },
      (e: unknown) => e as GraftError,
    );
    expect(err.code).toBe("TOKEN_INVALID");
    expect(err.fix).toContain("issuers");
  });
});

describe("requireScopes", () => {
  const anonymous = { actor: { kind: "anonymous" } as const };
  const unscoped = { actor: { kind: "agent", id: "a" } as const };
  const scoped = { actor: { kind: "agent", id: "a", scopes: ["read", "write"] } as const };

  it("denies anonymous actors even with no required scopes", () => {
    expect(requireScopes()(anonymous)).toBe(false);
  });

  it("allows any non-anonymous actor when no scopes are required", () => {
    expect(requireScopes()(unscoped)).toBe(true);
  });

  it("denies trusted-but-unscoped actors when scopes are required (strict)", () => {
    expect(requireScopes("read")(unscoped)).toBe(false);
  });

  it("requires every listed scope", () => {
    expect(requireScopes("read")(scoped)).toBe(true);
    expect(requireScopes("read", "write")(scoped)).toBe(true);
    expect(requireScopes("read", "admin")(scoped)).toBe(false);
  });
});

describe("betterAuthIssuer", () => {
  it("derives issuer, jwks URL, and audience from the instance URL", () => {
    expect(betterAuthIssuer({ url: "http://localhost:3000" })).toEqual({
      issuer: "http://localhost:3000",
      jwks: "http://localhost:3000/api/auth/jwks",
      audience: "http://localhost:3000",
      actorKind: undefined,
    });
  });

  it("honors basePath and audience overrides (null skips the check)", () => {
    const issuer = betterAuthIssuer({
      url: "https://app.test/",
      basePath: "/auth",
      audience: null,
      actorKind: "human",
    });
    expect(issuer.jwks).toBe("https://app.test/auth/jwks");
    expect(issuer.audience).toBeUndefined();
    expect(issuer.actorKind).toBe("human");
  });
});

describe("createOidcVerifier", () => {
  it("verifies directly given a token (unit seam for the MCP handler)", async () => {
    const verify = createOidcVerifier([issuerWithInlineJwks()]);
    const token = await mint({ claims: { scope: "a" } });
    await expect(verify(token)).resolves.toEqual({
      kind: "agent",
      id: "agent-1",
      scopes: ["a"],
    });
  });
});
