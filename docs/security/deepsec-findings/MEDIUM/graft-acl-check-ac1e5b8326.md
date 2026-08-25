# [MEDIUM] Content tools have no scope/role gating once authenticated; decide_approval trusts a caller-supplied operator identity

**File:** [`examples/docs-site/src/pages/api/mcp.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/docs-site/src/pages/api/mcp.ts#L33-L34) (lines 33, 34)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `acl-check`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

With auth required, every authenticated actor — regardless of scopes — can exercise write_content, put_asset, list_approvals and decide_approval (packages/mcp/src/server.ts applies no scope checks to these tools; requireScopes is only used by function access rules). The docs site currently has no issuer configured, so this mostly matters post-integration, but the seam is unsafe by construction: adding any issuer (as the landing page does) instantly makes every valid token a content-admin credential. Separately, decide_approval forwards an attacker-chosen `decidedBy` label into decideApproval(), whose anti-self-approval WHERE clause (requestedById != decidedBy) is trivially satisfied by naming someone else — undermining the separation-of-duties control at the application layer.

## Recommendation

Add scope-based access rules to MCP content/approval tools via the existing actor seam, and stamp decisions with the verified actor id (rejecting client-supplied identities).

## Revalidation

**Verdict:** true-positive

Both halves verified. (a) Missing authorization: packages/mcp/src/server.ts applies zero scope or role checks to write_content, put_asset, list_approvals, and decide_approval — scopes are consulted only inside run_function access rules via createFunctionsHandler — so docs-site's mcp.ts (actor: resolveActor wired at the flagged line) grants every authenticated actor full content-admin authority regardless of granted scopes; today the only credential is the owner GRAFT_DEV_TOKEN (resolveActor has issuers: [], so any other bearer gets TOKEN_INVALID 401), which makes the escalation latent-but-by-construction: adding any issuer instantly promotes narrow-scope tokens to content admins. (b) decide_approval forwards the client-supplied `decidedBy` label into decideApproval(), whose anti-self-approval WHERE clause compares that attacker-chosen string against the stored requestedById — trivially satisfied by naming anyone else — and this half is exploitable right now, including anonymously via the fail-open mount. This is a distinct vulnerability class (broken authorization/SoD) from F4's missing authentication at the same file, so not a duplicate; cross-file kinship with F1 (same flaw in server.ts) does not make it a duplicate under the rules. Medium fits: real seam defect, partial current exploitability.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
