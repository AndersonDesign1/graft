# Branch rulesets

These files are a **record of what is applied on GitHub**, not a mechanism that
applies it. Rulesets live in repository settings, and a change made in the web
UI leaves no diff anywhere — which is the whole reason this directory exists.

Committing a change here changes nothing until someone imports it.

## Verified

| File        | Ruleset      | ID         |
| ----------- | ------------ | ---------- |
| `main.json` | Protect main | `21730831` |

`main` is the only long-lived branch. Until 2026-10 the repository also had
`feat/core` as a working mainline, synced into `main` by pull request at each
release. `feat/core` became `main`, and its stricter ruleset moved with it.

This used to say "checked <date>", which is a claim with a shelf life — and the
one thing a record of branch protection cannot afford is going quietly stale.
CI now asserts it on every push and pull request (the `rulesets` job), so a rule
relaxed in the web UI fails the build:

```bash
pnpm check:ruleset-drift
```

It asserts every rule these files **declare** is in force, and compares bypass
actors in both directions. It does not apply the file: a commit that could
rewrite branch protection is a commit that could remove it, so the record can
fail the build without being able to weaken the branch.

Reading who can bypass needs a token with `administration: read`, and the
built-in `GITHUB_TOKEN` **cannot be one** — `administration` is not among the
permissions a workflow may request for it. The job reads a `RULESETS_TOKEN`
secret instead: a fine-grained PAT scoped to this repository with
`Administration: Read-only` and nothing else.

Until that secret exists the job skips, loudly, and says why. It does not pass:
without `bypass_actors` GitHub answers `200` with `rules` alone, and checking
the rules while never checking who may ignore them is worse than not checking —
it prints a green tick nobody should trust. A fork's pull request sees the same
skip, which is why a skip is not a failure.

To import a change: Settings → Rules → Rulesets → the ruleset → ⋯ → Import,
then paste the file.

## Why it looks under-protected, and why that is not an oversight

An automated reviewer reads these files and reports three things every time.
All three are accurate; none is an accident. Recorded here so the reasoning is
in the repository rather than re-derived in each review.

**Zero required approvals.** Graft has one maintainer.
Requiring an approving review would mean nobody can merge anything, because the
author cannot approve their own pull request. The protection that is actually
load-bearing here is the nine required status checks — `verify`,
`integration`, `container`, `Conventional title`, `Changeset present`,
`CodeQL`, `Dependency review`, `Workflow audit`, `Vercel` — plus
`required_review_thread_resolution`, which does bind: an unresolved review
thread blocks the merge whether or not anyone approved.

**`require_code_owner_review: false`, so `CODEOWNERS` is advisory.** Same
reason. `CODEOWNERS` still assigns review and still tells a contributor which
surfaces are security-sensitive, which is the job it is doing here.

**A `bypass_mode: "pull_request"` entry for the maintainer.** It lets the
maintainer merge a pull request the rules would otherwise hold, for example the
changesets version PR, whose CI GitHub never starts on its own. It does not
allow a direct push: every change to `main` still arrives through a pull
request.

These are the trade-offs of a single-maintainer pre-1.0 repository. They are
worth revisiting when there is a second maintainer, and not before — at which
point the answer is to raise `required_approving_review_count` on `main` first.
