# Branch rulesets

These files are a **record of what is applied on GitHub**, not a mechanism that
applies it. Rulesets live in repository settings, and a change made in the web
UI leaves no diff anywhere — which is the whole reason this directory exists.

Committing a change here changes nothing until someone imports it.

## Verified

Both rulesets are **active** and match these files byte for byte, checked
2026-08-31:

| File             | Ruleset           | ID         |
| ---------------- | ----------------- | ---------- |
| `feat-core.json` | Protect feat/core | `21730847` |
| `main.json`      | Protect main      | `21730831` |

Re-check without trusting this table:

```bash
gh api repos/AndersonDesign1/graft/rulesets -q '.[] | [.id, .name, .enforcement] | @tsv'
```

To import a change: Settings → Rules → Rulesets → the ruleset → ⋯ → Import,
then paste the file.

## Why it looks under-protected, and why that is not an oversight

An automated reviewer reads these files and reports three things every time.
All three are accurate; none is an accident. Recorded here so the reasoning is
in the repository rather than re-derived in each review.

**Zero required approvals, on both branches.** Graft has one maintainer.
Requiring an approving review would mean nobody can merge anything, because the
author cannot approve their own pull request. The protection that is actually
load-bearing here is the eight required status checks — `verify`,
`integration`, `container`, `Conventional title`, `Changeset present`,
`CodeQL`, `Dependency review`, `Workflow audit` — plus
`required_review_thread_resolution`, which does bind: an unresolved review
thread blocks the merge whether or not anyone approved.

**`require_code_owner_review: false`, so `CODEOWNERS` is advisory.** Same
reason. `CODEOWNERS` still assigns review and still tells a contributor which
surfaces are security-sensitive, which is the job it is doing here.

**`bypass_mode: "always"` for the maintainer on `feat/core`.** `feat/core` is
the working mainline — every change lands there, and it is the only branch that
publishes. Routing every commit through a pull request to the branch that _is_
the trunk would mean opening a pull request against itself. The bypass is
deliberate and it is visible when used: a bypassing push prints
`Bypassed rule violations for refs/heads/feat/core` in the git output, so it
cannot happen quietly.

`main` has **no bypass actors at all**, and that is the one that matters: `main`
is the public default branch, it is what visitors and npm land on, and it is
merged from `feat/core` at each release through a pull request that has to pass
every check.

These are the trade-offs of a single-maintainer pre-1.0 repository. They are
worth revisiting when there is a second maintainer, and not before — at which
point the answer is to raise `required_approving_review_count` on `main` first.
