# [MEDIUM] Approval decision attribution (decidedBy) is client-controlled, defeating the APPROVAL_SELF_DECISION separation-of-duties guard

**File:** [`packages/cli/src/commands/serve.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/serve.ts#L290) (lines 290)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-audit-tampering`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

graft serve mounts the Studio API with decidedBy: "studio-serve" (L290), implying decision attribution is authoritative. But the decide endpoint reads decidedBy from the request body: payload.decidedBy?.trim() || operator(options) (packages/studio/src/api.ts, decideMatch handler). decideApproval's separation-of-duties WHERE clause compares requestedById !== decidedBy (packages/db/src/approvals.ts), so whoever requested an approval can self-approve simply by supplying any other string (e.g. {"decision":"approved","decidedBy":"human-reviewer"}). This turns APPROVAL_SELF_DECISION — advertised as a guard that 'holds against the agent itself' — into a no-op for any caller of the Studio/MCP decide endpoints, and lets attackers forge who approved destructive operations in the audit trail. Only decided_role (= Postgres current_user) is trustworthy; decidedBy is fully attacker-chosen on this surface.

## Recommendation

Derive decidedBy from the authenticated actor resolved by the authorize callback (reject requests that attempt to override it), never from the request body. If a display name is needed, store it separately from the identity used for the separation-of-duties comparison.

## Revalidation

**Verdict:** true-positive

Verified in packages/studio/src/api.ts decideMatch handler: const row = await decideApproval(options.db, id, payload.decision, payload.decidedBy?.trim() || operator(options)) — the request body overrides the mount-time identity ('studio-serve' at serve.ts L290). decideApproval's separation-of-duties is purely the string comparison ne(approvals.requestedById, decidedBy) inside the UPDATE WHERE (approvals.ts). Any caller of the decide endpoint who knows the requester id (it is returned by GET /approvals, list_approvals, and the DESTRUCTIVE_OP_REQUIRES_APPROVAL response) supplies any other string and passes; when requestedById is NULL (anonymous filer) the or(isNull(...)) arm makes it pass regardless. Effect: APPROVAL_SELF_DECISION — described in code and docs as holding 'against the agent itself' — is a no-op on this surface, and the audit trail's decided_by is fully attacker-chosen; only decided_role (= current_user, stamped server-side in the same UPDATE) is trustworthy. This is a distinct root cause from F2 (authorization to reach the endpoint vs. integrity of attribution/separation-of-duties), so not a duplicate. MEDIUM fits: it needs a caller who already passed authorize (or loopback access).

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
