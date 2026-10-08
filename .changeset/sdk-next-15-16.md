---
"@usegraft/sdk-next": minor
"@usegraft/sdk-core": patch
"@usegraft/studio": patch
"@usegraft/contracts": patch
"@usegraft/mcp": patch
---

`@usegraft/sdk-next` now works on Next.js 15 as well as 16, and needs a
release with the 2026 security fixes. The peer ranges are
`next@^15.5.24 || ^16.3.3` and `react@^19.0.0`. CI builds and serves a real app
on each major, type-checks the Next.js guide's examples against it, and checks
reads, MDX, targeted refresh and `updateContent` in a real Server Action.

The package used to declare Next.js 15 or newer while calling APIs that only
Next.js 16 has. What changed for you:

- **Breaking:** the peer range now starts at 15.5.24 and 16.3.3, the first
  releases that fix the critical Next.js advisories published in 2026. Upgrade
  Next.js if you are on an older 15.x. Next.js 14 is not supported: it no
  longer gets security fixes, and those advisories are still open on it.
- `createGraft`, `MdxBody` and `revalidateContent` work on 15 and 16. On
  Next.js 15, tag your reads with `unstable_cache(fn, keys, { tags: tagsFor(...) })`.
  The Next.js guide shows both paths.
- `updateContent` still needs Next.js 16. On 15 it now throws a `GraftError`
  with code `FRAMEWORK_VERSION_UNSUPPORTED` whose `fix` names
  `revalidateContent`. Before, the package imported `updateTag` by name, and
  Next.js 15 does not export it.
- `@usegraft/sdk-next/config`, `@usegraft/sdk-core/db` and
  `@usegraft/studio/panels` now resolve their types under
  `moduleResolution: "node"`, the setting Next.js 15 writes into a new
  tsconfig. Before, those imports had no types there, and reads came back
  typed as `unknown`.

`FRAMEWORK_VERSION_UNSUPPORTED` is a new error code, with an entry in the error
reference and in `explain_error`.
