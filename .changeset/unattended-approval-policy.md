---
"@usegraft/core": patch
"@usegraft/cli": patch
"@usegraft/mcp": patch
---

Add `approvalPolicy: "unattended"`, so a caller with no human behind it can run
a destructive function.

`"none"` and `"human"` both had no answer for a scheduled job or a CI
migration. The destructive arm of the gate had no off switch at all, which is
the absence of a policy rather than a policy: those callers could never invoke
a destructive function, ever.

`"unattended"` turns the gate off entirely. Everything else is unchanged —
every invocation still writes its audit row with actor, correlation id and git
SHA, and access rules and rate limits still apply. What is given up is the
waiting, not the accounting.

`graft serve` reads it from `GRAFT_APPROVAL_POLICY=unattended` and warns on
every boot while it is on, because an env var is one line in a dashboard and
the log is where a mistake gets noticed.

Worth being explicit about the trade: git restores authored content, so a
deleted document comes back, but it does not restore operational data.
`deleteRecord` removes rows outright and the asset store keeps no history.
