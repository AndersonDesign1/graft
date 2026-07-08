/**
 * scoped-access — owned access helpers (edit freely).
 *
 * Name the token scopes your functions check in one place, then gate a function
 * with the matching rule. `requireScopes` (from @graft/auth) verifies the
 * caller's token carries the scope; anonymous or unscoped callers are rejected
 * with UNAUTHORIZED. Point the scope strings at whatever your token issuer
 * actually emits.
 */
import { requireScopes } from "@graft/auth";

/** The scopes this project's functions check. Rename or extend to match your issuer. */
export const SCOPES = {
  /** Approve/hide user-generated content (comments, reviews, …). */
  moderate: "content:moderate",
} as const;

/** Access rule: the caller's token must carry the moderation scope. */
export const requireModerator = requireScopes(SCOPES.moderate);
