/**
 * requireScopes — an access rule for defineFunction that honors the scopes a
 * trusted issuer put on the actor's token.
 *
 *   access: requireScopes("submissions:read")
 *
 * Strict: anonymous actors are denied, and a missing scopes claim counts as
 * no scopes — trusted-but-unscoped tokens don't pass scope gates. Mint scoped
 * tokens (or give dev tokens explicit `scopes`) for gated functions. With no
 * arguments it degrades to "any non-anonymous actor".
 */
import type { FunctionActor } from "@usegraft/core";

export function requireScopes(
  ...required: readonly string[]
): (ctx: { actor: FunctionActor }) => boolean {
  return ({ actor }) => {
    if (actor.kind === "anonymous") return false;
    const held = actor.scopes ?? [];
    return required.every((scope) => held.includes(scope));
  };
}
