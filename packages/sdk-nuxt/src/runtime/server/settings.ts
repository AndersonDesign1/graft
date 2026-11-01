/**
 * The project settings the routes read from graft.config.ts and the runtime
 * config, validated the way `graft serve` validates them. An unknown value is
 * refused rather than defaulted, so a typo cannot pick a weaker policy than
 * the one written down. No Nuxt imports, so it is tested on its own.
 */
import type { TrustedIssuer } from "@usegraft/auth";
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

/** The JWT issuers the functions and MCP routes trust, as `graft serve` reads them. */
export interface IssuerSettings {
  /** `NUXT_GRAFT_TRUSTED_ISSUERS`: issuer URLs, comma or space separated. */
  readonly trustedIssuers?: string;
  /** `NUXT_GRAFT_TRUSTED_AUDIENCE`: accepted `aud` values. Unset leaves `aud` unchecked. */
  readonly trustedAudience?: string;
  /** `NUXT_GRAFT_TRUSTED_ACTOR_KIND`: `"agent"` (the default) or `"human"`. */
  readonly trustedActorKind?: string;
}

const list = (value: string | undefined): string[] => (value ?? "").split(/[,\s]+/).filter(Boolean);

export function trustedIssuersFor(settings: IssuerSettings): TrustedIssuer[] {
  const audience = list(settings.trustedAudience);
  // Set but empty once parsed (","): a typo, not a choice. Treating it as unset
  // would turn the audience check off.
  if (settings.trustedAudience?.trim() && audience.length === 0) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `NUXT_GRAFT_TRUSTED_AUDIENCE is "${settings.trustedAudience}", which names no audience.`,
      fix: "Set NUXT_GRAFT_TRUSTED_AUDIENCE to the audience your provider puts in tokens for this app (comma-separated for several), or unset it.",
      details: { variable: "NUXT_GRAFT_TRUSTED_AUDIENCE", value: settings.trustedAudience },
    });
  }
  const kind = settings.trustedActorKind?.trim() || "agent";
  if (kind !== "agent" && kind !== "human") {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `NUXT_GRAFT_TRUSTED_ACTOR_KIND is "${kind}"; it must be "agent" or "human".`,
      fix: "Set NUXT_GRAFT_TRUSTED_ACTOR_KIND=human to record token holders as people, or unset it to record them as agents.",
      details: { variable: "NUXT_GRAFT_TRUSTED_ACTOR_KIND", value: kind },
    });
  }
  return list(settings.trustedIssuers).map((issuer) => {
    const trusted: TrustedIssuer = { issuer, actorKind: kind };
    if (audience.length > 0) trusted.audience = audience;
    return trusted;
  });
}
