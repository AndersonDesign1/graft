/**
 * OIDC/JWT verification — the trusted-issuer half of @graft/auth.
 *
 * Graft does not mint identity; it verifies it. A deployment lists the issuers
 * it trusts (a Better Auth instance it hosts, a company IdP, Vercel
 * Connect/Passport, …) and every bearer JWT must verify against one of them:
 * signature via the issuer's JWKS, `iss` match, `exp`, and (when configured)
 * `aud`. Verified claims become a FunctionActor: `sub` → id, scopes claim →
 * scopes.
 */
import { GraftError } from "@graft/contracts";
import type { FunctionActor } from "@graft/core";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

export interface TrustedIssuer {
  /** Expected `iss` claim, exactly as the issuer mints it (e.g. "https://auth.example.com"). */
  issuer: string;
  /**
   * Where the issuer's public keys live: a JWKS URL, or an inline JSON Web Key
   * Set (pinned keys — no network). Omitted → OIDC discovery at
   * `<issuer>/.well-known/openid-configuration`.
   */
  jwks?: string | JSONWebKeySet;
  /** Expected `aud` claim. Unchecked when omitted. */
  audience?: string | string[];
  /** What kind of actor this issuer authenticates. Defaults to "agent". */
  actorKind?: "agent" | "human";
  /**
   * Claim carrying scopes. Defaults to trying `scope` (space-separated string,
   * the OAuth2 convention), then `scopes`, then `permissions` (arrays).
   */
  scopesClaim?: string;
}

function tokenInvalid(reason: string, details?: Record<string, unknown>): GraftError {
  return new GraftError({
    code: "TOKEN_INVALID",
    message: `The bearer token could not be verified: ${reason}.`,
    fix: "Mint a fresh token from a trusted issuer and retry. Do not drop the Authorization header to fall back to anonymous — fix the token instead.",
    details: { reason, ...details },
  });
}

function readScopes(payload: JWTPayload, scopesClaim?: string): readonly string[] | undefined {
  const claims = scopesClaim ? [scopesClaim] : ["scope", "scopes", "permissions"];
  for (const claim of claims) {
    const value = payload[claim];
    if (typeof value === "string") return value.split(" ").filter(Boolean);
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  }
  return undefined;
}

/** One trusted issuer, with its key source resolved lazily and memoized. */
class IssuerVerifier {
  private getKey: JWTVerifyGetKey | undefined;

  constructor(readonly config: TrustedIssuer) {}

  private async keySource(): Promise<JWTVerifyGetKey> {
    if (this.getKey) return this.getKey;
    const { issuer, jwks } = this.config;
    if (jwks && typeof jwks === "object") {
      this.getKey = createLocalJWKSet(jwks);
    } else if (typeof jwks === "string") {
      this.getKey = createRemoteJWKSet(new URL(jwks));
    } else {
      // OIDC discovery — the issuer publishes where its keys live.
      const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
      const res = await fetch(discoveryUrl);
      if (!res.ok) {
        throw tokenInvalid(
          `OIDC discovery for issuer "${issuer}" failed (${res.status} from ${discoveryUrl})`,
        );
      }
      const metadata = (await res.json()) as { jwks_uri?: string };
      if (!metadata.jwks_uri) {
        throw tokenInvalid(`issuer "${issuer}" publishes no jwks_uri in its OIDC metadata`);
      }
      this.getKey = createRemoteJWKSet(new URL(metadata.jwks_uri));
    }
    return this.getKey;
  }

  async verify(token: string): Promise<FunctionActor> {
    const getKey = await this.keySource();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, getKey, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      }));
    } catch (err) {
      const code = (err as { code?: string }).code ?? "verification failed";
      throw tokenInvalid(`${code} (issuer "${this.config.issuer}")`);
    }
    return {
      kind: this.config.actorKind ?? "agent",
      id: payload.sub,
      scopes: readScopes(payload, this.config.scopesClaim),
    };
  }
}

/**
 * Verifies bearer JWTs against a list of trusted issuers. The token's own
 * `iss` claim picks the issuer config; an unlisted issuer is TOKEN_INVALID
 * (details name the trusted ones — self-teaching, an agent learns where to go).
 */
export function createOidcVerifier(
  issuers: readonly TrustedIssuer[],
): (token: string) => Promise<FunctionActor> {
  const verifiers = new Map(issuers.map((i) => [i.issuer, new IssuerVerifier(i)]));

  return async (token: string): Promise<FunctionActor> => {
    let iss: string | undefined;
    try {
      iss = decodeJwt(token).iss;
    } catch {
      throw tokenInvalid("the token is not a decodable JWT");
    }
    if (!iss) throw tokenInvalid("the token carries no `iss` claim");

    const verifier = verifiers.get(iss);
    if (!verifier) {
      throw tokenInvalid(`issuer "${iss}" is not trusted by this deployment`, {
        trustedIssuers: [...verifiers.keys()],
      });
    }
    return verifier.verify(token);
  };
}

/**
 * TrustedIssuer preset for a Better Auth instance (its `jwt`/OAuth-provider
 * plugins publish keys at `<basePath>/jwks` and mint `iss`/`aud` = its URL).
 */
export function betterAuthIssuer(options: {
  /** The Better Auth base URL (its `iss`), e.g. "http://localhost:3000". */
  url: string;
  /** Better Auth mount path. Defaults to "/api/auth". */
  basePath?: string;
  /** Expected audience. Defaults to `url`; pass null to skip the check. */
  audience?: string | string[] | null;
  actorKind?: "agent" | "human";
}): TrustedIssuer {
  const basePath = options.basePath ?? "/api/auth";
  return {
    issuer: options.url,
    jwks: `${options.url.replace(/\/$/, "")}${basePath}/jwks`,
    audience: options.audience === null ? undefined : (options.audience ?? options.url),
    actorKind: options.actorKind,
  };
}
