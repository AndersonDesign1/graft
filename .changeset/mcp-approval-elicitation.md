---
"@usegraft/mcp": patch
"@usegraft/cli": patch
---

Let a local MCP server ask its operator to decide a destructive call in-band,
instead of failing with an id for them to run `graft approve` on.

Opt-in and off by default: `approvalElicitation: { decider }` on
`createGraftMcp`, or `graft mcp --elicit-approvals`, which records the decision
as the OS user — exactly who `graft approve` records. A remote or public mount
must never enable it: there is nobody at the other end to ask.

What changes is how the human is reached. What does not change is anything
underneath: the decision is still a row in `approvals`, still one-shot, still
bound to the exact function and canonical input, still stamped with
`decided_role = current_user`, and still refused by Postgres when the decider is
the requester. `decider` is configured rather than taken from the connection
precisely because that predicate lives in the UPDATE's own `WHERE`.

A client that never declared the elicitation capability falls back to the
id-and-retry flow. Dismissing the prompt leaves the approval pending — only an
explicit no records a denial.

`delete_content`, `run_function` and the DESTRUCTIVE_OP_REQUIRES_APPROVAL
explanation all now say the in-band path exists, so an agent seeing either
outcome knows both are ordinary.
