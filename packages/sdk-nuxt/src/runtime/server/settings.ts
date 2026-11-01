/**
 * The project settings the routes read from graft.config.ts and the runtime
 * config, validated the way `graft serve` validates them. An unknown value is
 * refused rather than defaulted, so a typo cannot pick a weaker policy than
 * the one written down. No Nuxt imports, so it is tested on its own.
 */
import { trustedIssuersFrom, type TrustedIssuer } from "@usegraft/auth";
import { GraftError } from "@usegraft/contracts";

export type ApprovalPolicy = "none" | "human" | "unattended";
export type MdxTrust = "restricted" | "full";

/** The optional `approvalPolicy` export; `"none"` when omitted. */
export function approvalPolicyFor(value: unknown): ApprovalPolicy {
  if (value === undefined) return "none";
  if (value === "none" || value === "human" || value === "unattended") return value;
  throw new GraftError({
    code: "CONFIG_INVALID",
    message: `graft.config.ts exports \`approvalPolicy\` as ${JSON.stringify(value)}, which is not "none", "human" or "unattended".`,
    fix: 'Export `approvalPolicy = "none"` (the default: only `destructive` functions are gated), `"human"` (every mutation is gated), or `"unattended"` (nothing is gated, for a caller with no human behind it). Omit the export to keep the default.',
    details: { approvalPolicy: value },
  });
}

/** The optional `mdxTrust` export; `"restricted"` when omitted. */
export function mdxTrustFor(value: unknown): MdxTrust {
  if (value === undefined) return "restricted";
  if (value === "restricted" || value === "full") return value;
  throw new GraftError({
    code: "CONFIG_INVALID",
    message: `graft.config.ts exports \`mdxTrust\` as ${JSON.stringify(value)}, which is not "restricted" or "full".`,
    fix: 'Export `mdxTrust = "restricted"` (the default) or `mdxTrust = "full"` (every author has commit access, so code review is the control). Omit the export to keep the default.',
    details: { mdxTrust: value },
  });
}

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
    message: `${variable} (runtimeConfig.graft.${key}) is ${JSON.stringify(value)}, which is not text.`,
    fix: `Set ${variable} to plain text, such as a URL or a comma-separated list, not JSON.`,
    details: { variable, value },
  });
}

export function runtimeSettings(runtime: unknown): RuntimeSettings {
  return {
    databaseUrl: text(runtime, "databaseUrl", "NUXT_GRAFT_DATABASE_URL"),
    staticIndex: text(runtime, "staticIndex", "NUXT_GRAFT_STATIC_INDEX"),
    devToken: text(runtime, "devToken", "NUXT_GRAFT_DEV_TOKEN"),
    trustedIssuers: text(runtime, "trustedIssuers", "NUXT_GRAFT_TRUSTED_ISSUERS"),
    trustedAudience: text(runtime, "trustedAudience", "NUXT_GRAFT_TRUSTED_AUDIENCE"),
    trustedActorKind: text(runtime, "trustedActorKind", "NUXT_GRAFT_TRUSTED_ACTOR_KIND"),
  };
}

/** The JWT issuers the functions and MCP routes trust, as `graft serve` reads them. */
export function trustedIssuersFor(
  settings: Pick<RuntimeSettings, "trustedIssuers" | "trustedAudience" | "trustedActorKind">,
): TrustedIssuer[] {
  return trustedIssuersFrom(
    {
      issuers: settings.trustedIssuers,
      audience: settings.trustedAudience,
      actorKind: settings.trustedActorKind,
    },
    {
      code: "CONFIG_INVALID",
      variables: {
        audience: "NUXT_GRAFT_TRUSTED_AUDIENCE",
        actorKind: "NUXT_GRAFT_TRUSTED_ACTOR_KIND",
      },
    },
  );
}
