# [HIGH] stdio MCP server hands connected agents a decide_approval tool with agent-supplied identity — two-call self-approval of destructive ops

**File:** [`packages/cli/src/commands/mcp.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/mcp.ts#L52-L80) (lines 52, 56, 59, 79, 80)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** medium  •  **Slug:** `acl-check`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

mcpCommand wires the MCP server with the dev-token actor resolver and defaultAuthorization: devToken (L79-80). Through this server, an agent files a destructive-op approval via run_function/delete_content as requestedById "graft-cli" (the dev-token identity), then calls the shipped decide_approval tool (packages/mcp/src/server.ts ~L941-985) — a direct decideApproval() call with NO actor/scope check — passing decidedBy defaulted to "mcp-operator". Since "mcp-operator" !== "graft-cli", the APPROVAL_SELF_DECISION separation-of-duties WHERE clause passes, and the agent approves its own destructive operation without any human. The only durable mitigation is the opt-in hardened runtime DB role (no UPDATE on approvals via hardenRuntimeRole); out of the box DATABASE_URL is the owner credential, so the gate advertised as holding 'against the agent itself, not just accidents' is bypassable by the very agent it gates. This matches threat-model items 1 and 3 (a caller reaching decideApproval while skipping the human gate).

## Recommendation

Remove decide_approval from the stdio/project MCP server (keep it CLI/Studio-only), or bind it to an authenticated operator identity that cannot equal the requester (derive decidedBy from verified actor identity, never a tool argument), and refuse the tool unless the process is running under a role that is demonstrably operator-scoped.

## Revalidation

**Verdict:** true-positive

Confirmed end-to-end. mcp.ts wires createGraftMcp with actor: resolveActor and defaultAuthorization: devToken, but those only affect run_function/delete_content via invokeFunction; the registered decide_approval tool (server.ts ~L941-985) calls decideApproval directly with decidedBy?.trim() || 'mcp-operator' and never consults an actor. Attack: (1) agent calls delete_content/run_function for a destructive op — invokeFunction stamps Bearer <devToken>, the handler resolves {kind:'agent', id:'graft-cli'}, and the approval row gets requestedById='graft-cli' (or NULL when GRAFT_DEV_TOKEN is unset); (2) agent calls decide_approval — the default decidedBy 'mcp-operator' differs from 'graft-cli', so the WHERE clause or(isNull(requestedById), ne(requestedById, decidedBy)) passes and the process's own DB credential flips pending→approved; (3) retry with approval:<id> consumes it. No human ever decides. The design note (approval-hardening.md) explicitly assumed 'no approve surface exists over MCP/HTTP; decideApproval is CLI-only' — the shipped code contradicts that premise, and even the tool's own description ('Requires an owner DB role... The requester cannot decide their own approval') is defeated because the agent rides the server's owner credential and picks a different decidedBy string. The only durable mitigation is the opt-in graft harden runtime role (no UPDATE on approvals); out-of-the-box DATABASE_URL is the owner credential, so threat-model items 1 and 3 both apply. HIGH stands.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-10)
