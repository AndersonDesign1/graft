/**
 * The module's runtime config, read as text. Kept apart from settings.ts so
 * the content route, which every app mounts, does not load @usegraft/auth, an
 * optional peer only the functions and MCP routes need. No Nuxt imports, so it
 * is tested on its own.
 */
import { GraftError } from "@usegraft/contracts";

/**
 * The module's runtime config, as strings. Nuxt reads each `NUXT_GRAFT_*`
 * override through `destr`, so a value that looks like a number or a boolean
 * arrives as one: `NUXT_GRAFT_TRUSTED_AUDIENCE=123456` is the number 123456.
 * Those are turned back into the text that was written. Anything else (an
 * object, from a JSON-looking value) is refused, not stringified into
 * "[object Object]".
 */
export interface RuntimeSettings {
  readonly databaseUrl: string;
  readonly staticIndex: string;
  readonly devToken: string;
  /** `NUXT_GRAFT_DEV_SCOPES`: the dev token's scopes, comma or space separated. */
  readonly devScopes: string;
  /** `NUXT_GRAFT_TRUSTED_ISSUERS`: issuer URLs, comma or space separated. */
  readonly trustedIssuers: string;
  /** `NUXT_GRAFT_TRUSTED_AUDIENCE`: accepted `aud` values. Empty leaves `aud` unchecked. */
  readonly trustedAudience: string;
  /** `NUXT_GRAFT_TRUSTED_ACTOR_KIND`: `"agent"` (the default) or `"human"`. */
  readonly trustedActorKind: string;
}

/** One runtime setting as text, or a GraftError naming its variable. */
function text(runtime: unknown, key: keyof RuntimeSettings, variable: string): string {
  const fields: [string, unknown][] =
    typeof runtime === "object" && runtime !== null ? Object.entries(runtime) : [];
  const value = fields.find(([name]) => name === key)?.[1];
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new GraftError({
    code: "CONFIG_INVALID",
    // The type only: the value can hold a token or a database password, and
    // this error is answered to whoever made the request.
    message: `${variable} (runtimeConfig.graft.${key}) is a ${Array.isArray(value) ? "list" : typeof value}, not text.`,
    fix: `Set ${variable} to plain text, such as a URL or a comma-separated list, not JSON.`,
    details: { variable },
  });
}

export function runtimeSettings(runtime: unknown): RuntimeSettings {
  return {
    databaseUrl: text(runtime, "databaseUrl", "NUXT_GRAFT_DATABASE_URL"),
    staticIndex: text(runtime, "staticIndex", "NUXT_GRAFT_STATIC_INDEX"),
    devToken: text(runtime, "devToken", "NUXT_GRAFT_DEV_TOKEN"),
    devScopes: text(runtime, "devScopes", "NUXT_GRAFT_DEV_SCOPES"),
    trustedIssuers: text(runtime, "trustedIssuers", "NUXT_GRAFT_TRUSTED_ISSUERS"),
    trustedAudience: text(runtime, "trustedAudience", "NUXT_GRAFT_TRUSTED_AUDIENCE"),
    trustedActorKind: text(runtime, "trustedActorKind", "NUXT_GRAFT_TRUSTED_ACTOR_KIND"),
  };
}
