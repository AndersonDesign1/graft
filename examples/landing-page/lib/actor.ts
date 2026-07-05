/**
 * The one actor resolver both HTTP surfaces (functions + MCP) share: bearer
 * JWTs verified against the Better Auth instance this app hosts (lib/auth.ts),
 * plus GRAFT_DEV_TOKEN as a static local-dev credential. No token → anonymous;
 * a bad token → TOKEN_INVALID, never a silent downgrade.
 */
import { betterAuthIssuer, createActorResolver } from "@graft/auth";

export const resolveActor = createActorResolver({
  issuers: [betterAuthIssuer({ url: process.env.BETTER_AUTH_URL ?? "http://localhost:3000" })],
  devTokens: process.env.GRAFT_DEV_TOKEN
    ? {
        [process.env.GRAFT_DEV_TOKEN]: {
          kind: "human",
          id: "owner",
          // submissions:admin gates deleteSubmission — the dev owner has it;
          // Better Auth JWTs (scope: submissions:read) do not.
          scopes: ["submissions:read", "submissions:admin"],
        },
      }
    : undefined,
});
