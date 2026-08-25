# [MEDIUM] Client-supplied decidedBy is recorded verbatim and satisfies the approval separation-of-duties check

**File:** [`packages/studio/src/api.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/api.ts#L551-L555) (lines 551, 553, 555)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-audit-integrity`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

L551-555 passes `payload.decidedBy?.trim() || operator(options)` straight into decideApproval(). This single string serves two roles: (1) the attribution identity persisted to the approvals audit trail (approvals.decided_by), and (2) the value compared against requestedById in the UPDATE's WHERE clause that enforces requester != decider (packages/db/src/approvals.ts L147). Because the caller fully controls it, a requester can approve their own pending approval by submitting any invented identity (e.g. {"decision":"approved","decidedBy":"chief-operator"}), and the audit record will falsely show that identity made the decision — destroying both the accountability purpose of the human gate and the integrity of its enforcement. Only decided_role (Postgres current_user) is stamped server-side; the human-visible decidedBy is forgeable. This compounds the agent-authorization finding but applies to any caller of the decide endpoint, including MCP decide_approval which has the same pattern.

## Recommendation

Derive decidedBy exclusively from the authenticated actor identity resolved server-side; ignore or reject client-provided decidedBy values, and consider cross-checking decidedBy against the DB role/session binding.

## Revalidation

**Verdict:** true-positive

Confirmed at api.ts: the decide branch computes `payload.decidedBy?.trim() || operator(options)` and passes it straight into decideApproval() (L551-555). In packages/db/src/approvals.ts that single caller-supplied string serves two roles: it is persisted as decided_by (audit attribution) AND is the value compared against requestedById in the UPDATE WHERE clause enforcing requester != decider (L147). Only decided_role (Postgres current_user) is stamped server-side. Therefore any caller of the decide endpoint can approve its own pending approval by inventing an identity (e.g. {"decision":"approved","decidedBy":"chief-operator"}) — the separation-of-duties clause compares against a forged value and passes — while the audit trail records the invented operator as the human decision. I verified the same pattern exists in MCP decide_approval (mcp/server.ts L964 defaults to client-supplied or 'mcp-operator'), confirming this is systemic rather than a one-off, though this finding is scoped to the Studio file. This is a distinct defect from F1 (which is about which actors pass the authorize gate; F1 would persist even with server-stamped identities, and F4 persists even if the gate were human-only), so it is not a duplicate. MEDIUM stands.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
