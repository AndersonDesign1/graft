/**
 * The trusted-issuer settings a server reads from its environment, parsed one
 * way for every surface: `graft serve` reads `GRAFT_TRUSTED_*`, the Nuxt module
 * reads `NUXT_GRAFT_TRUSTED_*`. Each surface names its own variables and
 * error code; the rules are the same, so a fix to one cannot leave another
 * weaker.
 */
import { GraftError, type ErrorCode } from "@usegraft/contracts";
import type { TrustedIssuer } from "./oidc";

export interface TrustedIssuerSettings {
  /** Issuer URLs, comma or space separated. */
  readonly issuers?: string;
  /** Accepted `aud` values, comma or space separated. Unset leaves `aud` unchecked. */
  readonly audience?: string;
  /** `"agent"` (the default) or `"human"`: what the audit log records token holders as. */
  readonly actorKind?: string;
}

export interface TrustedIssuerSettingsSource {
  /** The code a bad value is refused with. */
  readonly code: ErrorCode;
  /** The variable each setting is read from, for the error message. */
  readonly variables: { readonly audience: string; readonly actorKind: string };
}

/** A comma- or space-separated setting as a list, with empty entries dropped. */
function listSetting(raw: string | undefined): string[] {
  return (raw ?? "").split(/[,\s]+/).filter(Boolean);
}

/**
 * The issuers to trust, each with the audience and actor kind applied. A
 * value that names nothing, or an actor kind that is not known, is refused
 * rather than read as unset, which would turn a check off.
 */
export function trustedIssuersFrom(
  settings: TrustedIssuerSettings,
  source: TrustedIssuerSettingsSource,
): TrustedIssuer[] {
  const { code, variables } = source;
  const audience = listSetting(settings.audience);
  if (settings.audience?.trim() && audience.length === 0) {
    throw new GraftError({
      code,
      message: `${variables.audience} is "${settings.audience}", which names no audience.`,
      fix: `Set ${variables.audience} to the audience your provider puts in tokens for this server (comma-separated for several), or unset it.`,
      details: { variable: variables.audience, value: settings.audience },
    });
  }
  const kind = settings.actorKind?.trim() || "agent";
  if (kind !== "agent" && kind !== "human") {
    throw new GraftError({
      code,
      message: `${variables.actorKind} is "${kind}"; it must be "agent" or "human".`,
      fix: `Set ${variables.actorKind}=human to record token holders as people, or unset it to record them as agents.`,
      details: { variable: variables.actorKind, value: kind },
    });
  }
  return listSetting(settings.issuers).map((issuer) => {
    const trusted: TrustedIssuer = { issuer, actorKind: kind };
    if (audience.length > 0) trusted.audience = audience;
    return trusted;
  });
}
