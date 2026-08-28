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

## Review the fixes, not just the code they fix

Every regression this repository has shipped was introduced _by_ a fix, and
found only by review that ran against the fix itself:

- The rate-limit peer moved off `x-forwarded-for` onto `x-graft-peer`, a header
  only the CLI adapter stripped — so in a Next.js or Astro route a client could
  still choose its own bucket. The same bug, relocated. It lives in a WeakMap
  keyed by the Request object now, which nothing over the wire can write.
- The MDX safety checker parsed with `remark-mdx` while the renderer compiled
  with `remark-gfm`, and treated a parse error as "nothing to execute" — true
  only if the checker is a superset of the renderer, and it was a subset.
- Scoping the `approvals` INSERT grant to seven columns fixed a real privilege
  escalation and broke `delete_content`, because Drizzle names every column and
  passes `default` for unset ones, and Postgres checks INSERT privilege on the
  columns a statement _names_. The unit suite passed: its control case wrote
  hand-written SQL naming exactly the granted columns.
- The canary guard added to catch a silent-success bug had a silent gap of its
  own: it globbed `packages/`, so a publishable package anywhere else in the
  workspace would have been skipped.

All four looked correct from inside the change. Two were caught by an
independent reviewer, one by a container test, one by re-reading the fix.

The practical rule: after fixing something, review the fix as if someone else
wrote it, and prefer a reviewer that runs the code over one that reads it.
