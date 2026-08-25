# [MEDIUM] Client-supplied decidedBy overrides the operator identity Studio stamps on approval decisions

**File:** [`packages/cli/src/commands/studio.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/studio.ts#L89-L90) (lines 89, 90)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-audit-tampering`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

studioCommand passes decidedBy: operatorName (L89) as the identity recorded on approval decisions, but the mounted Studio API accepts decidedBy from the request body first (payload.decidedBy?.trim() || operator(options) in packages/studio/src/api.ts). Because decideApproval's separation-of-duties check compares requestedById against this client-chosen string, a requester (including a local agent driving the API) can bypass APPROVAL_SELF_DECISION by submitting any different name, and the audit trail records a forged approver. The server-side decided_role column is the only tamper-proof field.

## Recommendation

Ignore client-provided decidedBy on the decide endpoint; derive it exclusively from the server-side operator identity configured at mount time (or the authenticated actor), treating any submitted value as a validation error.

## Revalidation

**Verdict:** true-positive

Verified: studioCommand passes decidedBy: operatorName (L89-90) intending decisions to be attributed to the OS user, but createStudioApiHandler prefers the request body (payload.decidedBy?.trim() || operator(options)), so any client of the local Studio HTTP surface overrides the operator stamp. Since decideApproval's APPROVAL_SELF_DECISION guard compares requestedById against exactly this string, a local agent that filed an approval (requestedById 'graft-cli'/null) approves it by posting any different name — e.g. the OS username itself — fully bypassing the advertised separation of duties, and the forged approver lands in decided_by while only decided_role is tamper-proof. This is the same underlying api.ts behavior flagged in F4 but reached through a different mount point and file (graft studio vs graft serve), which the duplicate rules treat as separate findings. Exploit requires local reachability, which the loopback-unauthenticated mount (F8) guarantees. MEDIUM is right: integrity/audit forgery and gate bypass on the local surface, not remote RCE.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
