# [MEDIUM] TOCTOU between dirty-state preflight and checkout can irreversibly destroy uncommitted content

**File:** [`packages/studio/src/revert.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/revert.ts#L44-L81) (lines 44, 63, 81)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

revertContentTo() relies on preflightRevert() (L44-79) to refuse when the content directory has uncommitted changes — the guard whose stated purpose is preventing destruction of unsaved work. But the check (`git status --porcelain`) and the mutation (`git checkout <sha> -- .`, L81) are two separate steps with no locking or atomicity. Anything that writes to the work-tree inside the window — an autonomous agent calling MCP write_content, another Studio tab saving a document (PUT /document also triggers a full compile), an editor autosave, or a second revert/commit request — lands after the dirty check and is then overwritten by checkout in BOTH the working tree and the index. Uncommitted means unrecoverable: authored content is silently lost while the endpoint reports success. Concurrent Studio+agent usage is an explicitly supported topology in this codebase (agents and humans operate the same checkout), making the window realistic rather than theoretical.

## Recommendation

Make the guard atomic: perform the dirty check and checkout inside a single git invocation sequence under an exclusive lock (e.g. flock on the repo, or `git -c core.checkStat minimal stash create` + verify + checkout), or snapshot uncommitted changes (stash/create) before checkout so nothing is ever destroyed unrecoverably.

## Revalidation

**Verdict:** true-positive

Verified the race structurally. revertContentTo() first awaits preflightRevert() — whose own git invocations (cat-file, status --porcelain) are async execFile calls (revert.ts L44-79) — checks pre.dirty.length === 0, and only afterwards awaits `git checkout <sha> -- .` (L81). There is no lock, transaction, or atomicity spanning check and mutation, so any writer landing in the window is silently clobbered: checkout rewrites both the working tree and index for tracked paths, destroying uncommitted edits with no recovery path, while the endpoint reports success. Concurrent writers are a supported topology, not hypothetical — agents call MCP write_content (plain writeFileSync + compile) against the same checkout, and every Studio document save (PUT /document triggers writeDocumentFile + full compile) plus editor autosave writes during normal operation. Even two racing revert/commit requests interleave badly. The window is milliseconds wide, which tempers exploitability, but the failure mode is unrecoverable authored-content loss on an explicitly multi-writer system and the guard's entire stated purpose ('uncommitted changes would be destroyed') fails open. MEDIUM is defensible; keeping it.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
