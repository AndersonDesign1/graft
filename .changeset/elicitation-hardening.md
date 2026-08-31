---
"@usegraft/mcp": patch
---

Refuse elicited approvals over HTTP, and stop a failed prompt breaking the call.

Three findings from cubic's review of the pull request, all on
`approvalElicitation`.

**`createGraftMcpHandler` now throws `CONFIG_INVALID` if given
`approvalElicitation`.** It was documented as "a remote or public mount must
never set it" and enforced nowhere. A documented caution is the wrong shape for
this one, because getting it wrong inverts the gate rather than weakening it:
over HTTP the client being asked to approve _is_ the agent that made the call,
while `decider` is configured server-side — so an accepted prompt is
self-approval recorded under the operator's name. `requested_by_id <>
decided_by` lives in the UPDATE's own `WHERE` precisely so that cannot happen,
and asking the requester's own client walks around it. `createGraftMcp` (stdio,
operator at the machine) still accepts it.

**A failed elicitation falls back instead of failing the tool call.** The
capability check covered a client that never declared it; a client that declares
it and then fails the request — older SDK, a schema it will not render, a
transport that times out with the dialog open — let the error escape as a raw
`McpError`. It now falls through to the id-and-retry path, the same answer an
undeclared capability gets. Nothing is decided, so the row stays pending for a
human to find.

**The prompt no longer truncates silently.** Inputs were cut at 300 characters
with an ellipsis; the limit is now 1000 and the message says it truncated, gives
the full length, and points at `graft approvals`. A consent dialog that shows
part of what is being consented to without saying so is worse than no preview,
because the reader believes they have seen the call.
