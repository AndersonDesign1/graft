/**
 * Who is calling the functions and MCP routes. Kept out of handler.ts because
 * the content route imports handler.ts and must not load the optional auth peer.
 */
import { runtimeSettings } from "./runtime-config";
import { trustedIssuersFor } from "./settings";

/**
 * The dev token's scopes: `NUXT_GRAFT_DEV_SCOPES`, comma or space separated,
 * as `graft serve` reads `GRAFT_DEV_SCOPES`. Unset, the token can write
 * content, which is what a local editor needs.
 */
function devScopes(raw: string): string[] {
  const scopes = raw.split(/[,\s]+/).filter(Boolean);
  return scopes.length > 0 ? scopes : ["content:write"];
}

/** Who is calling, from the runtime config, the same way `graft serve` decides. */
export function actorOptions(runtime: unknown) {
  const settings = runtimeSettings(runtime);
  // A dev token never expires, so it is accepted only in development. An unset
  // NODE_ENV counts as production, so a deploy that forgets it stays closed.
  const devToken = process.env.NODE_ENV === "development" ? settings.devToken : undefined;
  return {
    issuers: trustedIssuersFor(settings),
    devTokens: devToken
      ? {
          [devToken]: {
            kind: "human" as const,
            id: "owner",
            scopes: devScopes(settings.devScopes),
          },
        }
      : undefined,
  };
}
