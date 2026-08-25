# [HIGH] Operator-only Studio actions reachable by agent-kind actors, enabling self-approval of destructive operations

**File:** [`packages/studio/src/api.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/api.ts#L374-L555) (lines 374, 375, 376, 386, 540, 551, 555)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `acl-check`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The Studio API's only authorization is a binary 'authenticated or not' callback (api.ts L374-386). When mounted by `graft serve --studio`, that callback is wired as `actor.kind !== "anonymous"` (cli/src/commands/serve.ts L278-281), which accepts ANY authenticated principal — including kind:"agent" actors, which is exactly what GRAFT_DEV_TOKEN maps to (serve.ts L198: `{ kind: "agent", id: "graft-serve", scopes }`) and what OIDC issuers authenticate by default (packages/auth/src/oidc.ts). Behind this gate sit operator-only operations: POST /api/studio/v1/approvals/{id}/decide (L540-568), compilation revert (L575+), changes/commit, document PUT, and compile. Critically, the approval decision path defeats the human gate for destructive functions: decideApproval()'s separation-of-duties guard compares requestedById vs decidedBy (packages/db/src/approvals.ts L143-151), but the Studio stamps decidedBy from a server-fixed default ('studio-serve') or client input — never the caller's actor identity. An autonomous agent holding only GRAFT_DEV_TOKEN can therefore request a destructive function call (requester id 'graft-serve'), then POST /api/studio/v1/approvals/<id>/decide {"decision":"approved"}; decidedBy ('studio-serve') differs from the requester, so the guard passes and the agent approves its own destructive operation with no human involved. This directly contradicts the project threat model ('decideApproval — operator-only', 'destructive: true is always human-gated') and matches the project-specific anti-pattern 'an access rule that treats actor.kind === agent as trusted'. The DB-role split is the intended backstop, but serve.ts wires branch.db from the single DATABASE_URL with no hardened runtime role, so in the default deployment the UPDATE succeeds.

## Recommendation

Restrict the Studio authorize callback to operator identities (e.g. actor.kind === "human" or a dedicated studio scope), not merely 'non-anonymous'; stamp decidedBy from the verified caller identity server-side rather than a constant or client-supplied string so the requester!=decider check is meaningful.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. In cli/src/commands/serve.ts the Studio authorize callback is wired as `actor.kind !== "anonymous"` when bound off loopback with a dev token or issuers, so ANY authenticated principal passes — GRAFT_DEV_TOKEN maps to `{ kind: "agent", id: "graft-serve", scopes }` (serve.ts L196-199) and OIDC tokens verify into kind:"agent" actors by default (auth.test.ts L99-107). The decide route (api.ts L540-568) sits behind only this gate and stamps decidedBy from the server-fixed default 'studio-serve' (`decidedBy: "studio-serve"` in startServe) or client input. packages/db/src/approvals.ts L143-151 enforces separation of duties solely by comparing requestedById != decidedBy inside the UPDATE's WHERE clause; approvals filed via POST /api/fn record requestedById = actor.id = 'graft-serve' (functions-handler.ts L323), which differs from 'studio-serve', so the guard passes and the agent approves its own destructive request with no human involved. On loopback mounts authorize is undefined entirely, making the endpoint unauthenticated locally. I also confirmed the DB-role backstop is not active by default: resolveBranchHandle returns controlDb built from the single owner DATABASE_URL for overlay branches (db/src/branch.ts), and hardenRuntimeRole is only applied by the opt-in `graft harden` command — grep shows no caller in serve/studio paths. Full chain: agent requests destructive fn (403 + approval id) → POST /api/studio/v1/approvals/<id>/decide {"decision":"approved"} → retry with x-graft-approval header → consume succeeds. Real and exploitable.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
