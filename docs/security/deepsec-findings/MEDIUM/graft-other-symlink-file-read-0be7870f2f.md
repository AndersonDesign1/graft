# [MEDIUM] Symlinks inside the content directory allow reading arbitrary files via the diff endpoint

**File:** [`packages/studio/src/git.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/git.ts#L329-L395) (lines 329, 330, 383, 395)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-symlink-file-read`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

safeContentPath() (L296-330) enforces confinement purely lexically — resolve() + prefix check — and readFileDiff() then operates on the resolved path directly. If the content tree contains a symlink (git repositories can commit symlinks, so a cloned project template or any supply-chain source can plant one, e.g. docs/notes.mdx -> /home/operator/.ssh/id_rsa), existsSync/statSync/readFileSync all follow it. The read path: for an existing file whose `git diff HEAD -- <path>` output is empty (true for committed symlinks and any untracked entry), L395 falls back to addedFileDiff(fullPath), which at L330 does readFileSync(fullPath, 'utf8') on the symlink TARGET and returns its full contents as rendered diff hunks to whoever called GET /api/studio/v1/changes/diff. Result: arbitrary world-readable files outside the content directory (SSH keys, env files, other projects) are disclosed through the Studio API whenever a hostile repository is opened in the Studio. Note looksBinary() also follows the symlink, but text targets sail through to the disclosure path.

## Recommendation

lstat() the resolved path and refuse symlinks (or resolve real paths and re-run the containment check) in safeContentPath()/readFileDiff before any readFileSync; treat a symlinked changed file as binary/unreadable in the drawer.

## Revalidation

**Verdict:** true-positive

Confirmed symlink-following read primitive. safeContentPath() (git.ts L296-330) enforces confinement purely lexically — resolve()+prefix check, rejecting absolute paths/NUL/'..' — and performs no lstat, so a symlink INSIDE the content tree pointing outside passes. readFileDiff() then existsSync/statSync/readFileSync on the resolved path (all follow symlinks); when `git diff HEAD -- <path>` output is empty — true for a clean committed symlink — it falls back to addedFileDiff() (L330) which readFileSync's the TARGET and returns its contents verbatim as rendered '+' diff lines to the GET /api/studio/v1/changes/diff caller. Crucially, unlike commitChanges() which intersects requested paths with the live change set, the diff endpoint accepts ANY path (api.ts changes/diff handler passes the raw query param), so the file needn't even appear dirty. Discovery is easy: readCollectionDocs walks the disk and lists symlinked .mdx entries via statSync in the tree endpoint. looksBinary() follows the symlink too but text targets like OpenSSH keys (base64 text, no NUL bytes) pass the sniff. Exploitation requires a planted/hostile symlink (cloned template or supply-chain repo, since write flows create regular files), which keeps this MEDIUM rather than HIGH, matching the filing.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
