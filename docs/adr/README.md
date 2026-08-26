# Architecture decision records

One file per decision, numbered, never edited after it lands except to change
`Status`. A decision that turns out wrong gets a new ADR that supersedes it;
the original stays as written.

## Why these exist

`docs/design-notes/` was doing this job without the discipline. The
approval-hardening note opened with "no approve surface exists over MCP/HTTP"
and built a threat model on it. That was true when written. It stopped being
true when `decide_approval` shipped as an MCP tool, and nothing re-checked it —
because a prose note has no field that goes stale visibly, and no test asserted
the premise. The security work in `0.2.0` is mostly the consequence.

So every ADR here states **Premise**: the thing that must remain true for the
decision to remain right. When you change something that contradicts a premise,
you are changing a decision, and you write the ADR that supersedes it.

## Format

```markdown
# NNNN — <decision, as a statement>

- **Status:** Accepted | Superseded by NNNN | Rejected
- **Date:** YYYY-MM-DD

## Context

What forced a decision.

## Decision

What we do. Present tense, not aspirational.

## Premise

What must stay true for this to remain the right call. The falsifiable part.

## Consequences

What this costs, and what it makes harder.
```

Design notes keep their place for explanation — how a subsystem works, what a
spike found. Decisions live here.
