# [HIGH] Anonymous MCP callers can decide approvals; configuring identity silences the bind warning without enabling enforcement

**File:** [`packages/cli/src/commands/serve.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/serve.ts#L202-L266) (lines 202, 217, 226, 265, 266)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `missing-auth`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The MCP handler is mounted with requireActor: requireMcpActor (L226), which defaults to false (GRAFT_MCP_REQUIRE_AUTH !== "1", L202). Inside createGraftMcpHandler, requireActor is the ONLY gate; tools like list_approvals and decide_approval call listPendingApprovals/decideApproval directly with no per-tool actor or access check (packages/mcp/src/server.ts ~L911-985). So on any deployment bound beyond loopback without GRAFT_MCP_REQUIRE_AUTH=1, an unauthenticated remote attacker can: (1) list pending approvals, (2) call decide_approval with decision "approved" (the server's own DB credential performs the UPDATE, so the runtime-role hardening that protects direct SQL does not apply to this path), and (3) retry the destructive run_function with the x-graft-approval header — a complete human-gate bypass with zero credentials. There is also a subtle logic gap: the warning condition (L266) treats `issuers.length > 0 || devToken` as sufficient, but those only configure the resolver — they do NOT enable requireActor. An operator who sets GRAFT_DEV_TOKEN before binding publicly receives NO warning, yet anonymous decide_approval remains fully reachable.

## Recommendation

Default GRAFT_MCP_REQUIRE_AUTH to on whenever the host is not loopback, and make the warning condition test actual enforcement (!requireMcpActor) rather than resolver configuration. Additionally, remove decide_approval from the network-reachable MCP surface or gate it behind an explicit operator credential/scope so agents and anonymous callers cannot reach it.

## Revalidation

**Verdict:** true-positive

Verified: requireMcpActor = process.env.GRAFT_MCP_REQUIRE_AUTH === '1' (L202) — off unless explicitly set (the Docker entrypoint sets it for containers, but bare `graft serve --host 0.0.0.0`, the documented headless topology, does not). In http.ts, resolveActor returning ANONYMOUS (no Authorization header) passes when requireActor is falsy; createGraftMcp then registers list_approvals and decide_approval unconditionally with no per-tool actor/scope/access checks. An unauthenticated remote attacker can therefore JSON-RPC tools/call decide_approval — the UPDATE runs under whatever credential DATABASE_URL holds (owner out-of-the-box), so runtime-role hardening of direct SQL is irrelevant to this path — then replay run_function/delete_content with the approval id: a zero-credential human-gate bypass. The warning-logic gap is also real: L266 treats issuers.length > 0 || devToken as sufficient to skip the bind warning, but those only configure the resolver, not enforcement — setting GRAFT_DEV_TOKEN silences the warning while anonymous decide_approval stays open. Even with requireActor on, authenticated agents would still reach the tool (that facet overlaps F1), but the finding's core claim about anonymous reachability and misleading warning suppression is accurate. HIGH.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
