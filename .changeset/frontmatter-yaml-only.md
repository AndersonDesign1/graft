---
"@usegraft/mdx-safety": minor
"@usegraft/compiler": minor
"@usegraft/studio": minor
"@usegraft/content-migrations": patch
"@usegraft/cli": patch
"@usegraft/mcp": patch
---

**BREAKING:** frontmatter is read as YAML or JSON only. gray-matter runs a `---js` frontmatter block through `eval`, so a contributor's Studio save, an agent's `write_content`, or a pull request built by `graft compile` could run code on the machine reading it. Every read now goes through `readFrontmatter` from the new `@usegraft/mdx-safety/frontmatter` entry, which refuses any other language with `INPUT_VALIDATION_FAILED` before parsing, whatever `mdxTrust` is. A lint rule stops gray-matter being imported anywhere else.

**BREAKING:** `POST /api/studio/v1/changes/commit` and `POST /api/studio/v1/compilations/:id/revert` need `studio:publish`. They asked for `studio:write`, so a contributor could commit to the checkout, or roll it back, around the check Studio's Commit button makes.

Also fixed:

- `graft studio` with `GRAFT_DEV_TOKEN` gives the operator every admin scope, as its documentation says. Since contributors were stopped from committing locally, the token's missing `studio:publish` stopped the operator committing too.
- Without a database, a media upload or delete is refused before the bucket is touched. Both used to change the bucket, then answer `NEEDS_DATABASE`.
