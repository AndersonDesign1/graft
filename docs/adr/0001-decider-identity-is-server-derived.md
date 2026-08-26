# 0001 — The identity that decides an approval is derived server-side

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

`decideApproval` took `decidedBy: string`, and every surface let the caller
supply it: an MCP tool argument, a Studio request-body field, a CLI flag. That
string was the entire separation-of-duties control, because the check is the SQL
predicate `requestedById != decidedBy`. An agent that filed an approval could
approve it by naming anyone else.

The `decided_role` column was already stamped server-side and was doing its job.
It records the _credential_, though, and out of the box both sides of the gate
run under the same one.

## Decision

The decider is an `ApprovalDecider` (`{ kind, id }`) established by the surface
from a verified caller. No surface accepts a decider as input, and the MCP tool
has no `decidedBy` argument at all.

Two corollaries follow from the same reasoning:

- An approval whose requester has no stable id is **undecidable**
  (`APPROVAL_UNATTRIBUTED`). The old `requested_by_id IS NULL` arm made those
  decidable by anyone, including whoever filed them.
- A human-gated call from an actor with no stable id is refused rather than
  filed, so an unattributable approval cannot come into existence.

## Premise

Every surface that can decide an approval can establish who is calling it.
Today: MCP from the connection's authenticated actor, Studio from its
`authenticate` callback or its mount-time operator identity, CLI from the OS
user the process runs as.

**If a new deciding surface cannot identify its caller, this decision does not
cover it** — that surface must not exist rather than fall back to a placeholder.

## Consequences

- Breaking: `decideApproval`'s signature, the MCP tool schema, and the Studio
  mount option all changed. Free at `0.1.1` with no install base; expensive later.
- `graft mcp` grants itself `content:write` but deliberately not
  `approvals:decide`, so the CLI requesting and `graft approve` deciding stay
  two identities. A single local developer still gets a real gate.
- Anonymous callers can no longer reach human-gated functions at all. That is a
  behaviour change for any deployment that served them, and the intended one.
