---
"@usegraft/sdk-next": minor
"@usegraft/contracts": patch
"@usegraft/mcp": patch
---

`@usegraft/sdk-next` now supports Next.js 14, 15 and 16 with the App Router.
The peer ranges are `next@^14.2.0 || ^15.0.0 || ^16.0.0` and
`react@^18.2.0 || ^19.0.0`. CI runs the adapter's tests and type-check, and
type-checks the Next.js guide's examples, against each major.

The package used to declare Next.js 15 or newer while calling APIs that only
Next.js 16 has. What changed for you:

- `createGraft`, `MdxBody` and `revalidateContent` work on all three versions.
  On Next.js 14 and 15, tag your reads with `unstable_cache(fn, keys, { tags: tagsFor(...) })`.
  The Next.js guide shows both paths.
- `updateContent` still needs Next.js 16. On 14 and 15 it now throws a
  `GraftError` with code `FRAMEWORK_VERSION_UNSUPPORTED` whose `fix` names
  `revalidateContent`. Before, the package imported `updateTag` by name, and
  Next.js 14 and 15 do not export it.
- `withGraft` reads the installed Next.js version. On 14 it sets
  `experimental.serverComponentsExternalPackages`. On 15 and 16 it sets
  `serverExternalPackages`. Your existing values are kept either way.

`FRAMEWORK_VERSION_UNSUPPORTED` is a new error code, with an entry in the error
reference and in `explain_error`.
