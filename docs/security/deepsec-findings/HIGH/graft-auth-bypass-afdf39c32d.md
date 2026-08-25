# [HIGH] MCP decide_approval trusts a caller-supplied decider identity, letting the requester self-approve destructive operations

**File:** [`packages/mcp/src/server.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/mcp/src/server.ts#L940-L962) (lines 940, 947, 948, 950, 953, 955, 962)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `auth-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The decide_approval tool takes `decidedBy` as a free-text, optional tool argument (defaulting to the literal string "mcp-operator") and passes it straight to decideApproval() (packages/db/src/approvals.ts). The ONLY separation-of-duties control is the SQL predicate `or(isNull(approvals.requestedById), ne(approvals.requestedById, decidedBy))` — i.e., the 'human' is identified by an attacker-chosen string, not by any authenticated identity. Attack scenario (exactly threat-model item #1): (1) an agent calls a destructive function or delete_content, filing an approval whose requestedById is its actor id (or NULL for an anonymous/defaultAuthorization-less server); (2) the same agent calls decide_approval { id, decision: "approved", decidedBy: "any-string-other-than-my-id" } — the WHERE clause passes and the approval flips to approved; (3) the agent retries the call with the approval id and the destructive operation executes. When the approval was requested by an anonymous actor (requestedById NULL), even the default "mcp-operator" value satisfies isNull(requestedById) and approves it outright. Both deployment surfaces that expose this tool run on the owner-role DATABASE_URL connection — `graft mcp` builds its db via createDb(requireDatabaseUrl()) and `graft serve` passes branch.db to createGraftMcpHandler — so the documented control 'runtime DB role must not UPDATE approvals' does not protect them. On `graft serve` with GRAFT_MCP_REQUIRE_AUTH off (the default), the entire file→approve→consume loop is reachable unauthenticated over HTTP. The APPROVAL_SELF_DECISION guard is therefore cosmetic: the DB-stamped decided_role records the same owner role on both sides of the gate.

## Recommendation

Bind the decider identity to the resolved actor, not to user input: resolve the caller via the configured actor resolver (as run_function does), reject anonymous deciders, and derive decidedBy from actor.kind/actor.id instead of accepting a `decidedBy` tool argument. Additionally, consider requiring the deciding request to carry a distinct operator credential/scope (e.g. a scope the agent runtime tokens never receive), and treat requestedById IS NULL rows as undecidable from MCP.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. server.ts's decide_approval tool (lines 940-977) accepts an optional caller-supplied `decidedBy` string (default 'mcp-operator'), resolves NO actor identity, and passes it straight into decideApproval(). In packages/db/src/approvals.ts the entire separation-of-duties control is the UPDATE predicate `or(isNull(approvals.requestedById), ne(approvals.requestedById, decidedBy))` — a comparison between a stored id and an attacker-chosen string. functions-handler.ts stamps `requestedById: actor.id ?? null`, so an agent that files an approval under its own id defeats the check by supplying any other label, and an anonymous requester (NULL) is approved by the default value alone via the isNull branch. The consume step (graft_consume_approval, migration 0007) checks only status/function/inputCanonical, never requester-vs-consumer, so once approved the retry executes. The claimed DB-role backstop does not hold on any shipped surface: `graft mcp` builds its handle from createDb(requireDatabaseUrl()) (commands/mcp.ts), `graft serve` passes branch.db from createDb(url) into createGraftMcpHandler (commands/serve.ts), and both examples pass createDb(DATABASE_URL) — all owner credentials with UPDATE on approvals, making the decided_role stamp identical on both sides of the gate. Concrete chain: run_function/delete_content (files 403 with approval id) → decide_approval {id, decision:'approved', decidedBy:'x'} → retry with approval id. This is precisely threat-model item #1 realized at the application layer.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-10)
