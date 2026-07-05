/**
 * createActorResolver — the seam createFunctionsHandler (and the MCP HTTP
 * handler) plug into to answer "who is calling?".
 *
 * Resolution order for `Authorization: Bearer <token>`:
 *   1. dev tokens — exact-match static tokens for local/self-host development
 *   2. trusted-issuer JWT verification (see oidc.ts)
 * No Authorization header (or a non-Bearer scheme) → anonymous. A bearer token
 * that fails verification is TOKEN_INVALID (401) — a bad credential is an
 * error to fix, never a silent downgrade to anonymous.
 */
import { GraftError } from "@graft/contracts";
import type { FunctionActor } from "@graft/core";
import { createOidcVerifier, type TrustedIssuer } from "./oidc";

export interface ActorResolverOptions {
  /** OIDC issuers whose JWTs this deployment accepts. */
  issuers?: readonly TrustedIssuer[];
  /**
   * Static bearer tokens → actors, for development and self-host bootstrap.
   * Keep these out of production: no expiry, no scoping ceremony, one shared
   * secret. Example: `{ [process.env.DEV_TOKEN!]: { kind: "human", id: "owner" } }`.
   */
  devTokens?: Record<string, FunctionActor>;
}

export type ActorResolver = (request: Request) => Promise<FunctionActor>;

const ANONYMOUS: FunctionActor = { kind: "anonymous" };

export function createActorResolver(options: ActorResolverOptions = {}): ActorResolver {
  const devTokens = new Map(Object.entries(options.devTokens ?? {}));
  devTokens.delete(""); // an unset env var must never become a valid credential
  const verifyJwt = options.issuers?.length ? createOidcVerifier(options.issuers) : undefined;

  return async (request: Request): Promise<FunctionActor> => {
    const header = request.headers.get("authorization");
    if (!header) return ANONYMOUS;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return ANONYMOUS; // some other auth scheme — not ours to judge
    const token = match[1].trim();

    const dev = devTokens.get(token);
    if (dev) return dev;

    if (verifyJwt) return verifyJwt(token);

    // A token was sent but nothing is configured to accept one.
    throw new GraftError({
      code: "TOKEN_INVALID",
      message: "A bearer token was sent, but this deployment has no trusted issuers configured.",
      fix: "Configure `issuers` (or a dev token) in createActorResolver, or call without an Authorization header if anonymous access is intended.",
    });
  };
}
