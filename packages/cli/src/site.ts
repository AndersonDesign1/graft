/**
 * A hosted site's address, as a person types it: checked and cut back to its
 * origin. Shared by every command that sends a secret to a site
 * (`graft studio invite`, `graft login`), so they agree on what is safe.
 */
import { GraftError } from "@usegraft/contracts";
import { isLoopbackHost } from "@usegraft/compiler";

export interface SiteOriginUse {
  /** What travels to the site, for the plain-http refusal: "sign-in token". */
  sends: string;
  /** How the caller passes the address, for the fix: "Pass --url". */
  passIt: string;
}

/**
 * `https://shop.example.com/studio` → `https://shop.example.com`. Graft's
 * routes are at the site's root, so a pasted path is dropped. Plain http is
 * refused except on loopback: the secret would cross the network unencrypted.
 */
export function parseSiteOrigin(input: string, use: SiteOriginUse): string {
  const parsed = URL.canParse(input) ? new URL(input) : undefined;
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${input}" is not an http(s) URL.`,
      fix: `${use.passIt} with the site's address, such as https://shop.example.com.`,
    });
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${input}" uses plain http, which would send the ${use.sends} unencrypted.`,
      fix: "Pass the https address, such as https://shop.example.com. Plain http is accepted only for localhost, 127.0.0.1 and [::1].",
    });
  }
  return parsed.origin;
}
