# [HIGH] Studio authorize callback admits ANY authenticated actor (including agents) to operator-only endpoints

**File:** [`packages/cli/src/commands/serve.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/serve.ts#L276-L292) (lines 276, 277, 278, 279, 280, 281, 285, 292)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `acl-check`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

When graft serve binds beyond loopback with a dev token or trusted issuers, the Studio authorize callback (L276-283) returns true for any actor whose kind !== "anonymous" — including agents minted from GRAFT_DEV_TOKEN ({kind:"agent", id:"graft-serve"}) or OIDC tokens (default actorKind "agent"). No scope or human-kind check is applied (requireScopes is never used here). The Studio API mounted behind this callback exposes operator-only operations: POST /api/studio/v1/approvals/:id/decide (decideApproval), PUT /api/studio/v1/document (writes MDX files), POST /changes/commit, compilations/:id/revert, and POST /compile (packages/studio/src/api.ts). An autonomous agent holding any valid bearer token therefore reaches the human-decision surface over HTTP, violating the documented invariant 'decideApproval — operator-only (CLI / Studio / MCP)' and threat model items 1 and 3. Combined with the client-controlled decidedBy field (see separate finding), an agent can approve its own destructive operations entirely through this endpoint.

## Recommendation

Restrict the Studio authorize callback to operator identities only — e.g. require actor.kind === "human", or a dedicated operator scope (requireScopes("studio:operator")) — rather than any non-anonymous actor. Do not share the agent dev-token/OIDC trust config between the function/MCP surfaces and the Studio decision surface.

## Revalidation

**Verdict:** true-positive

Verified at serve.ts L276-285: when bound beyond loopback with devToken or issuers configured, authorize resolves the bearer and returns true for ANY actor whose kind !== 'anonymous'. Both identity sources mint agent-kind actors here: GRAFT_DEV_TOKEN maps to {kind:'agent', id:'graft-serve'} (L217) and TrustedIssuer.actorKind defaults to 'agent' (oidc.ts). No requireScopes, no kind==='human' check anywhere in this path (grep confirms the only kind !== 'anonymous' gate in the repo is this callback). Behind that callback, createStudioApiHandler exposes POST /api/studio/v1/approvals/:id/decide (decideApproval), PUT /document (writes MDX files), /changes/commit, /compilations/:id/revert, and /compile. So an autonomous agent holding its normal runtime token reaches the operator decision surface over HTTP, contradicting the documented invariant 'decideApproval — operator-only' and threat-model items 1/3. Combined with F4's body-supplied decidedBy, self-approval is complete. Opt-in --studio mounting tempers reach slightly but does not mitigate once enabled; HIGH is correct.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
