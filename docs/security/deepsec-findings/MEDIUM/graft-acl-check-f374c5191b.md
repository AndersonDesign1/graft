# [MEDIUM] Authenticated low-privilege users get unrestricted content-admin powers over MCP; approval separation-of-duties uses a caller-supplied identity

**File:** [`examples/landing-page/app/api/mcp/route.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/app/api/mcp/route.ts#L33-L36) (lines 33, 36)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `acl-check`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

Even with GRAFT_MCP_REQUIRE_AUTH=1, the MCP content tools (write_content, put_asset, list_approvals, decide_approval in packages/mcp/src/server.ts) perform no scope or role checks whatsoever — scopes are only consulted inside run_function access rules. Meanwhile lib/auth.ts hands EVERY self-registered account (email/password sign-in is enabled) a JWT scoped 'submissions:read commerce:orders:read commerce:orders:write'. Any site user can therefore mint a token at GET /api/auth/token and gain full content-authoring, asset-upload, and approval-decision authority — a privilege escalation from 'authenticated reader' to 'content admin' that defeats the app's own scope policy. Compounding this, the decide_approval tool passes a caller-chosen `decidedBy` string into decideApproval(), whose separation-of-duties WHERE clause compares requestedById != decidedBy — an agent that requested an approval under id 'agent-A' can approve its own request by supplying decidedBy='mcp-operator', voiding the requester-cannot-decide control (only the optional Postgres role split remains as a backstop).

## Recommendation

Gate MCP tools behind requireScopes-style rules (e.g. content:write for write_content/put_asset, approvals:decide for decide_approval) using the same actor resolver already wired in. Derive decidedBy from the verified actor identity server-side instead of accepting a client-supplied stamp.

## Revalidation

**Verdict:** true-positive

Both claims verified against source. lib/auth.ts enables emailAndPassword sign-in and its jwt definePayload stamps EVERY self-registered account's token with scope "submissions:read commerce:orders:read commerce:orders:write" (minted at GET /api/auth/token); with GRAFT_MCP_REQUIRE_AUTH=1 such a user passes http.ts's requireActor check (kind 'human', not anonymous) and can then invoke write_content, put_asset, list_approvals, and decide_approval, none of which consult scopes anywhere in packages/mcp/src/server.ts — a genuine privilege escalation from scoped reader/writer to unrestricted content admin, asset uploader, and approval decider that defeats the app's own scope policy. Second claim: the route forwards the caller-chosen decidedBy into decideApproval(), whose separation-of-duties predicate (requestedById IS NULL OR requestedById != decidedBy) is satisfied by naming a different label, voiding the application-layer control and leaving only the optional Postgres role split — which this single-DATABASE_URL example does not deploy — as backstop. Distinct vulnerability class (authorization/SoD) from F6's authentication gap at the same file, hence not a duplicate; relation to F1 is cross-file similarity, which does not count. MEDIUM is appropriate.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
