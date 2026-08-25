# [BUG] looksBinary reads entire files into memory just to test the first 8KB

**File:** [`packages/studio/src/git.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/git.ts#L364-L368) (lines 364, 367, 368)
**Project:** graft
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-resource-exhaustion`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

looksBinary() (L364-369) calls statSync only to short-circuit zero-byte files, then readFileSync(fullPath) loads the WHOLE file into a Buffer solely to run .includes(0) on the first 8000 bytes. A multi-gigabyte file placed in the content directory (committed by an agent via write flows, or present in a cloned repo) makes every diff/status render attempt allocate the full file in memory, which can OOM the Studio process — turning a routine UI action into a remote-ish denial of service against the local tool. The comment says 'a NUL byte in the first block' but the code reads far more than a block.

## Recommendation

Open the file with fs.open + read into an 8KB buffer (or stream the first block) instead of readFileSync of the whole file.

## Revalidation

**Verdict:** true-positive

Verified exactly as described in git.ts L364-369: looksBinary() calls statSync only to short-circuit zero-byte files, then executes `const buffer = readFileSync(fullPath); return buffer.subarray(0, 8000).includes(0);`. Despite the comment ('a NUL byte in the first block') and despite subarray being zero-copy, readFileSync allocates and holds the ENTIRE file in memory just to inspect the first 8KB. Every diff render of a changed file goes through this function (readFileDiff calls it before anything else), so a multi-gigabyte file sitting in the content tree — reachable via a cloned repo or any content-write flow — makes each GET /changes/diff allocate the whole file, plausibly OOM-ing the Studio process. The fix (fs.open + read into an 8KB buffer) is trivial and the current behavior is plainly unintended given the comment. Real bug, BUG severity correct.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
