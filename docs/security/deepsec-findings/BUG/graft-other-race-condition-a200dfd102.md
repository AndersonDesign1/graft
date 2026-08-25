# [BUG] Artifact replacement window where the static index does not exist

**File:** [`packages/db/src/static.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/db/src/static.ts#L311-L312) (lines 311, 312)
**Project:** graft
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

projectStaticContent replaces the compiled artifact with rmSync(options.path) followed by renameSync(tmpPath, options.path). Between these two calls the artifact file does not exist at all, contradicting the code comment's invariant that readers 'open a fully-written file or the old one'. A reader calling openStaticIndex in that window gets STATIC_INDEX_NOT_FOUND instead of stale-or-new data, and if the process crashes after rmSync but before renameSync, the index artifact is destroyed entirely until the next successful compile. Impact is limited because compile normally runs as a build step before serving, hence BUG rather than a security severity.

## Recommendation

Use renameSync directly (atomic on POSIX) and handle the Windows case separately, or write to a versioned filename and swap a symlink/directory pointer atomically so a complete artifact always exists at the read path.

## Revalidation

**Verdict:** true-positive

The flagged sequence is present verbatim in projectStaticContent: rmSync(options.path, { force: true }) followed by renameSync(tmpPath, options.path), introduced specifically because rename-over-existing was assumed to fail on Windows. During the window between these two synchronous calls the artifact path does not exist, which directly falsifies the adjacent code comment claiming readers 'open a fully-written file or the old one'. The read side proves the observable effect: openStaticIndex begins with existsSync(path) and throws STATIC_INDEX_NOT_FOUND otherwise, so any concurrent reader (dev server, deployed app re-serving while graft compile runs) gets a hard error instead of stale-or-new data. Additionally, a crash after rmSync but before renameSync destroys .graft/index.db entirely until the next successful compile — a permanent loss, not just a transient window. On POSIX, rename(2) atomically replaces the existing file, making rmSync unnecessary there and confirming the recommended fix is sound. This is a genuine availability/correctness defect in the artifact-replacement routine, though non-adversarial (no attacker control over timing beyond triggering a rebuild), which matches its BUG classification.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-23)
