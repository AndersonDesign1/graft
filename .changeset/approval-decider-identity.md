---
"@usegraft/contracts": minor
"@usegraft/studio": minor
"@usegraft/core": minor
"@usegraft/mcp": minor
"@usegraft/cli": minor
"@usegraft/db": minor
---

Approval decisions are attributed to a verified identity, never to caller input.

`decideApproval` took a `decidedBy: string` that every surface let the caller
supply. That string is the entire separation-of-duties control — the UPDATE's
WHERE clause compares it against `requested_by_id` — so anyone who could name it
could approve their own destructive operation by naming somebody else. The
guard was decorative.

**Breaking:**

- `decideApproval(db, id, decision, decidedBy)` now takes an `ApprovalDecider`
  (`{ kind, id }`) instead of a string.
- The MCP `decide_approval` tool no longer accepts a `decidedBy` argument. It
  attributes the decision to the identity the connection authenticated as, via
  the new `connectionActor` option, and refuses an unauthenticated connection.
- `POST /api/studio/v1/approvals/{id}/decide` ignores `decidedBy` in the body;
  the Studio's `decidedBy` mount option is now `decider: ApprovalDecider`.
- An approval whose requester has no stable id is **undecidable**
  (`APPROVAL_UNATTRIBUTED`). The old `requested_by_id IS NULL` arm made those
  approvable by anyone, including whoever filed them.
- A human-gated function called by an actor with no stable id is refused with
  `UNAUTHORIZED` instead of filing an approval nobody can be accountable for.

Adds a `decided_by_kind` column (migration `0008`) so attribution records what
kind of actor decided, matching `requested_by_kind`.
