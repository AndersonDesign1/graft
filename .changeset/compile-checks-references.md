---
"@usegraft/compiler": minor
"@usegraft/db": minor
"@usegraft/mcp": patch
"@usegraft/cli": patch
---

**BREAKING:** `graft compile` now stops on a `field.reference({ to })` that
names a document that doesn't exist, with `CONTENT_REFERENCE_NOT_FOUND`.
Until now a reference was checked only by `graft check`, so a product whose
category had been deleted compiled, and the site found the gap at render
time. A project that compiled with a broken reference fails now. Run
`graft check` to list every one, then fix them or create the missing
documents.

The error names each file, field and missing slug in `details.references`:

```txt
Error CONTENT_REFERENCE_NOT_FOUND: 1 reference(s) name a document that doesn't exist: products/wool-hat.mdx "category" points at categories/hats.
```

Both content sources make the check, because both go through
`validateDocuments`. In a database-sourced project, a publish refuses a draft
whose reference isn't live, and refuses to publish the deletion (or a new
slug) of a document that live documents still point at. Publish them together,
changed to point elsewhere.

`validateDocuments` takes a new `references` option. `"files"` checks targets
among the files given, which is right for a whole tree, and `readDocs` uses it
by default. A set of `collection/slug` keys also counts those as existing, for
a caller checking part of a larger whole. Without the option, references are
not checked. `liveDocuments` in `@usegraft/db` lists a branch's live
documents for that set.
