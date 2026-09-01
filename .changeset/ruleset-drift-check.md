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

Reading bypass actors needs `administration: read`, which the built-in
`GITHUB_TOKEN` cannot hold — that permission is not one a workflow may request
for it. The job reads a `RULESETS_TOKEN` secret (a fine-grained PAT scoped to
this repository, `Administration: Read-only`). Until it exists the job skips and
says why rather than passing: without `bypass_actors` GitHub answers `200` with
`rules` alone, and checking the rules while never checking who can ignore them
prints a green tick nobody should trust. A fork's pull request sees the same
skip, so outside contributors are not blocked. It runs as its own job rather
than inside `verify`, keeping that token away from the runner that executes
every installed dependency.
