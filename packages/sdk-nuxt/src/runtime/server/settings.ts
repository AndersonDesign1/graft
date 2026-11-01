/**
 * The project settings the routes read from graft.config.ts and the runtime
 * config, validated the way `graft serve` validates them. An unknown value is
 * refused rather than defaulted, so a typo cannot pick a weaker policy than
 * the one written down. No Nuxt imports, so it is tested on its own.
 */
import { trustedIssuersFrom, type TrustedIssuer } from "@usegraft/auth";
import { GraftError } from "@usegraft/contracts";
import type { RuntimeSettings } from "./runtime-config";

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
