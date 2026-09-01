---
"@usegraft/cli": patch
---

CI asserts that `.github/rulesets/*.json` still matches the branch protection
GitHub is actually enforcing.

Those files are a record, not a mechanism — a rule relaxed in the web UI leaves
no diff anywhere, which is why the directory exists and also its weakness. The
README carried "checked 2026-08-31", a claim with a shelf life. `pnpm
check:ruleset-drift` turns it into a job.

It is deliberately one-directional: it never applies the file, because a commit
that could rewrite branch protection is a commit that could remove it. The
record can fail the build without being able to weaken the branch.

Reading bypass actors needs `administration: read`. Without it GitHub answers
`200` with `rules` and silently omits `bypass_actors` — a check that compared
rules, skipped the actors who can ignore those rules, and printed OK would be
worse than no check, so an absent key skips with the reason instead. That is
also what a fork's pull request sees, so outside contributors are not blocked.
It runs as its own job rather than inside `verify`, to keep the wider token away
from the runner that executes every installed dependency.
