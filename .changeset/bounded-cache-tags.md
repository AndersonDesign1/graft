---
"@usegraft/sdk-core": patch
---

Keep every cache tag within 256 characters. Next.js skips a longer tag with a
warning instead of an error, and a skipped tag is never invalidated, so a page
read under a long slug stayed stale after its content changed.
`documentTag` and `collectionTag` now return a tag longer than 256 characters
as its first part plus a digest of the whole. Reads and `tagsForChanges` build
tags the same way, so they still match. Tags of 256 characters or fewer are
unchanged.
