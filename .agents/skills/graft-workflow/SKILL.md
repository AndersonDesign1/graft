---
name: graft-workflow
description: How to do engineering work in the Graft repo from request to pull request. Picks a playbook (investigation, bug fix, feature, refactor, docs change, UI change, review, long run, correct), applies Graft's principles, verifies on the real surface, and opens a PR the Graft way. Use at the start of any non-trivial task, for "fix", "build", "add", "refactor", "investigate", "why does", "review this PR", "run until done", or "open a PR".
---

# Working in Graft

Go deep first, then go fast: a small, verified change beats a large,
plausible one.

## Start every task the same way

1. **Pick a playbook** from the table. Open it and copy its steps into your
   todo list (TaskCreate or TodoWrite) before any task-specific items. A step
   you skip stays in the list as `skip: <reason>`.
2. **Read what the playbook names.** Always `CONTEXT.md` for the words, and
   `CONVENTIONS.md` before you write code.
3. **Name the principles you apply** in your final reply, each with the
   decision it changed. Naming one without a decision behind it is a tell
   that you did not apply it.

| Task | Playbook |
| --- | --- |
| A question: how does X work, why is Y this way, are we sure | [investigation](playbooks/investigation.md) |
| A reported defect | [bug-fix](playbooks/bug-fix.md) |
| New or changed behavior | [feature](playbooks/feature.md) |
| Same behavior, better structure | [refactor](playbooks/refactor.md) |
| A docs page, guide or reference | [docs-change](playbooks/docs-change.md) |
| Anything a person sees: site, Studio, components | [ui-change](playbooks/ui-change.md) |
| Review a diff or PR | [review](playbooks/review.md) |
| "Run until done", "I'm stepping away", resuming a session | [long-run](playbooks/long-run.md) |
| The same correction a second time | [correct](playbooks/correct.md) |
| Every playbook ends here | [opening-a-pr](playbooks/opening-a-pr.md) |

Related skills: `graft-verify` (prove it works), `graft-design` (anything
visual), `graft-writing` (any words, including commits and PRs).

## Principles

Apply the ones the task triggers. Each line is the whole rule.

**How much to build**

- **Subtract before you add.** Delete dead code, stale paths and redundant
  checks first, then build on the smaller base. The smallest change that
  solves the problem wins.
- **Name the data shape first.** Before logic, choose the types and the
  structure that holds them: a state machine over booleans, a table over
  branching, a typed model over repeated shape checks.
- **Redesign, don't bolt on.** Integrate a new requirement as if it had been
  known from the start.
- **Attack the premise.** After two fixes that share an assumption both fail,
  stop and question the assumption.
- **Build the lever.** For repeated or bulk work, write the script or codemod
  that does or proves it. A reviewer can rerun a script; they cannot rerun
  your hands.

**Where things live** (these match Graft's invariants)

- **Boundary discipline.** Validate once where data enters (Zod at config,
  frontmatter, HTTP and MCP input). Trust internal types after that. Errors
  that cross a package boundary are `GraftError` with a `fix`.
- **Make illegal states unrepresentable.** Brand identifiers, use unions for
  states, parse at the boundary.
- **Idempotent operations.** A compile, migration or merge run twice ends in
  the same state. Design for a crash halfway.
- **Migrate callers, then delete the old API,** in the same change. No
  compatibility shims for internal code.

**What counts as proof**

- **Prove it works.** Run the real thing (`graft-verify`), read the real
  value. "It compiles" and "the tests pass" are not proof of behavior.
- **Fix root causes.** Reproduce first, then find why, then fix. A guard that
  hides a broken invariant is not a fix.
- **Test behavior, not implementation.** Call the code the way its users do
  and assert a literal expected value. Delete a test that would still pass if
  every function it imports returned `undefined`.
- **Explain the number.** Before you report a measurement, say what limits it
  and rule out that it measured something else.
- **Small verifiable units.** Each step ends in a check before the next one
  starts. Commits land in an order that proves itself, a failing test before
  its fix.

**Working with agents**

- **Guard the context window.** Send bulk reading and wide searches to a
  subagent; keep conclusions in the main thread.
- **Never block on the human for reversible work.** Decide, do it, report
  it. If a fork can be settled by running something, run it instead of
  asking.
- **Encode lessons in structure.** The second time you write the same
  instruction, make it a lint rule, a `check:*` script, a type or a test
  instead.

## Autonomy

**Go ahead without asking:** reading anything, editing files, running local
commands and tests, creating local branches, commits, and pushes to your own
working branch.

**Always stop and ask** before anything that is hard to undo or that other
people see: force-pushes to shared branches, publishing packages, deploys,
deleting data or branches on a real service (Neon, S3, GitHub), touching
`main` or `feat/core` directly, posting public comments, and any command that
uses a credential from the environment. This mirrors Graft's own rule:
destructive operations wait for a person.

**"No" is an allowed answer.** If asked whether to add something and it does
not earn its place, say so and why.

## Subagents

- Give a subagent a complete brief: the goal, file paths, the data shape,
  what done looks like, and how to verify. It has none of your context.
- Read-only work (search, investigation) goes to `Explore`. Design work goes
  to `Plan`. Code goes to `general-purpose`.
- For a second opinion, run the same prompt on a different model (`model`:
  `opus`, `sonnet` or `fable`). Findings that two models raise independently
  are the strongest signal.
- You own what a subagent produces. Read its diff and verify it yourself;
  never forward its summary as your result.
- A follow-up goes to a fresh subagent with the consolidated brief, unless it
  needs state only the old one has (a running server, uncommitted work).

## The final reply

- Lead with what changed for the person using Graft, then what the next
  maintainer inherits.
- Short sentences. No em dashes (`graft-writing`).
- Label every claim: **verified** (you ran it, with the output), **inferred**
  (from reading code), or **guess**.
- Paste the decisive evidence verbatim: the failing and passing output, the
  screenshot path, the test count.
- Never link or cite something you did not open in this session.
- List open decisions the user has to make, each with your recommendation.
