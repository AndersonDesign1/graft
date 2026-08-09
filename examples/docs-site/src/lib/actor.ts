/**
 * The one actor resolver both HTTP surfaces (functions + MCP) share.
 * The docs site hosts no issuer of its own — GRAFT_DEV_TOKEN is the static
 * local-dev credential; add OIDC issuers here when the site grows accounts.
 * No token → anonymous; a bad token → TOKEN_INVALID, never a silent downgrade.
 */
import { createActorResolver } from "@usegraft/auth";

export const resolveActor = createActorResolver({
  issuers: [],
  devTokens: process.env.GRAFT_DEV_TOKEN
    ? {
        [process.env.GRAFT_DEV_TOKEN]: {
          kind: "human",
          id: "owner",
          scopes: ["content:moderate"],
        },
      }
    : undefined,
});
