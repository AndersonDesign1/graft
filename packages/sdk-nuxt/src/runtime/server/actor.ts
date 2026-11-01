/**
 * Who is calling the functions and MCP routes. Apart from handler.ts because
 * it loads @usegraft/auth, an optional peer the content route must not need.
 */
import { runtimeSettings } from "./runtime-config";
import { trustedIssuersFor } from "./settings";

/** Who is calling, from the runtime config, the same way `graft serve` decides. */
export function actorOptions(runtime: unknown) {
  const settings = runtimeSettings(runtime);
  // A dev token never expires, so it is accepted only in development. An unset
  // NODE_ENV counts as production, so a deploy that forgets it stays closed.
  const devToken = process.env.NODE_ENV === "development" ? settings.devToken : undefined;
  return {
    issuers: trustedIssuersFor(settings),
    devTokens: devToken
      ? { [devToken]: { kind: "human" as const, id: "owner", scopes: ["content:write"] } }
      : undefined,
  };
}
