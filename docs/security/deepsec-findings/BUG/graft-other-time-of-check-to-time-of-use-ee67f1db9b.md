# [BUG] applyPlan trusts stale plan snapshot for conflict detection, silently overwriting concurrently changed files

**File:** [`packages/registry/src/add.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/src/add.ts#L168-L185) (lines 168, 185)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-time-of-check-to-time-of-use`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The REGISTRY_FILE_EXISTS guard (L168-176) decides solely from plan.conflicts, which planAdd snapshotted earlier (exists/identical computed at L99-100, conflicts at L147). applyPlan never re-stats targets before writeFileSync (L185): if a differing file appears or changes on disk between planning and applying — another process, an editor save, or a concurrent agent write (Graft explicitly treats agents as first-class actors mutating the same project) — it is overwritten without the guard firing, even though the user never passed --overwrite. The CLI re-plans immediately before applying so its window is small, but planAdd/applyPlan are exported library APIs designed for separate dry-run/apply invocations where the gap is unbounded.

## Recommendation

Inside applyPlan, immediately before each writeFileSync, re-run the existsSync/readFileSync comparison against current disk state and recompute the conflict decision (throwing REGISTRY_FILE_EXISTS unless options.overwrite), rather than trusting the plan-time snapshot.

## Revalidation

**Verdict:** true-positive

Verified exactly as described: applyPlan's REGISTRY_FILE_EXISTS guard (add.ts ~L168) tests only plan.conflicts, which planAdd computed from disk at planning time (~L99-100, L147), and the write loop (~L185) executes mkdirSync/writeFileSync without ever re-running existsSync/readFileSync against current state; the identical-skip flag is equally stale. planAdd/applyPlan are exported public API of @usegraft/registry (imported by the CLI from the package entrypoint), and their documented purpose includes separate dry-run/apply invocations where the check-to-use gap is unbounded. Even in the bundled CLI flow, addCommand runs planAdd then applyPlan synchronously but other processes — including agents, which Graft explicitly treats as first-class concurrent actors mutating the project — can change a target between the two calls. Concrete failure: planAdd previews cleanly, another process edits graft/comments.ts, applyPlan then overwrites it with registry content even though the user never passed --overwrite, violating the guard's stated contract ('guarded at apply time'). This is a genuine correctness/race bug rather than a security bypass, so BUG severity is appropriate; the fix (re-stat and recompute the conflict decision immediately before each write inside applyPlan) is standard TOCTOU hygiene.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
