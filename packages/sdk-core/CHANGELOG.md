# @usegraft/sdk-core

## 1.0.0-beta.4

### Patch Changes

- Updated dependencies [4831a77]
  - @usegraft/contracts@1.0.0-beta.4
  - @usegraft/core@1.0.0-beta.4
  - @usegraft/db@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- f92b97c: Keep every cache tag within 256 characters. Next.js skips a longer tag with a
  warning instead of an error, and a skipped tag is never invalidated, so a page
  read under a long slug stayed stale after its content changed.
  `documentTag` and `collectionTag` now return a tag longer than 256 characters
  as its first part plus a digest of the whole. Reads and `tagsForChanges` build
  tags the same way, so they still match. Tags of 256 characters or fewer are
  unchanged.
- f92b97c: `@usegraft/sdk-next` now works on Next.js 15 as well as 16, and needs a
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

- Updated dependencies [56c0957]
- Updated dependencies [f92b97c]
  - @usegraft/db@1.0.0-beta.3
  - @usegraft/contracts@1.0.0-beta.3
  - @usegraft/core@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- @usegraft/contracts@1.0.0-beta.2
- @usegraft/core@1.0.0-beta.2
- @usegraft/db@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- 52fc3e6: Install commands drop `@beta`. A plain install is now the right install.

  Every README said `npm i @usegraft/<pkg>@beta`, because `latest` pointed at
  `0.2.0` while the docs described `1.0.0-beta.x`. Writing the tag into 22 files
  treated the symptom. The defect was the dist-tag: `latest` is what a bare
  install resolves, and it resolved to somewhere nobody should land.

  `latest` now points at the prerelease across all 21 published packages, and the
  `0.x` line is deprecated, so the tag has nothing left to do. `install-tag.mjs`
  inverts with it — it strips tags instead of adding them, and CI fails if one
  comes back.

  The half a script cannot check is the registry. Publishing a prerelease while
  `latest` sits on something older reopens the original bug and nothing in the
  repo will notice. That property is kept by moving the tag at release, and it is
  written down in the script rather than assumed.

- Updated dependencies [27b8468]
- Updated dependencies [52fc3e6]
  - @usegraft/contracts@1.0.0-beta.1
  - @usegraft/core@1.0.0-beta.1
  - @usegraft/db@1.0.0-beta.1

## 1.0.0-beta.0

### Minor Changes

- e2829b4: **BREAKING:** `createClient` takes `index` and no longer takes `db`. Pass a
  Postgres handle to `createDbClient` from the new `@usegraft/sdk-core/db` entry
  point instead. Every framework adapter's `createGraft` still takes either shape,
  so app code that used an adapter is unaffected.

  `npm i @usegraft/sdk-react` installed `postgres` and `drizzle-orm`. cubic
  flagged it on the pull request and it was worse than a stray manifest entry:
  `sdk-core/src/client.ts` imported `createDbIndexReader` from `@usegraft/db` for
  its **value**, so the database package was reachable code, not a tree-shakeable
  type import — in a package whose stated premise is that a database handle never
  reaches the browser. The README and `/docs/sdk-reference` both made that claim
  while the dependency graph contradicted it.

  The runtime edge now lives in `@usegraft/sdk-core/db`, and `@usegraft/db` is an
  **optional peer dependency** of `sdk-core`. A server adapter declares it
  outright and resolves it; a browser install never pulls it. The five server
  adapters gained it as a direct dependency, which is honest — they always did
  need it.

  **The type edge had to move too, or the fix would only have been half true.**
  `ClientOptions` referenced `Database`, and `ContentRow` was
  `typeof contentIndex.$inferSelect` — derived from a Drizzle table — so any
  package that merely wanted to _describe_ a row had to install a database driver
  to name the type. `ContentRow`, `ContentIndexReader`, `ReaderReadOptions`,
  `ReaderSearchOptions`, `ContentSearchHit` and `ChangeSet` now live in
  `@usegraft/contracts`, the layer every package already shares.

  `@usegraft/db` re-exports all six, so existing imports keep resolving, and its
  table now _proves_ it still matches the published contract instead of defining
  it — a compile-time assignment that fails if a column changes type. The
  dependency runs the right way round now: the seam owns the shape and the
  implementation conforms to it.

  `@usegraft/content-api` drops `@usegraft/db` entirely; its imports were always
  type-only.

  Two smaller fixes fall out of the same review. `@usegraft/sdk-react` now refuses
  a **per-read** `branch` on an endpoint-backed handle, not just one passed to the
  constructor: the content API pins its branch server-side and rejects the query
  param, so `getContent(c, s, { branch })` silently read main while the caller
  believed they were reading a preview. And the three read helpers are `async`, so
  that refusal arrives as a rejection rather than a synchronous throw from a
  function declared to return a promise — the kind a caller handling errors with
  `.catch()` never sees. An index-backed handle is unaffected, which is tested,
  because that is the one configuration where a branch is meaningful.

### Patch Changes

- 655e4d1: **BREAKING:** `@usegraft/db` is an optional peer dependency of
  `@usegraft/core` rather than a dependency.

  `db-out-of-the-browser` moved the database off sdk-core's direct dependencies,
  but only half the graph went with it. `@usegraft/core` stayed a hard dependency
  of sdk-core and kept its own hard dependency on `@usegraft/db`, so the chain
  survived one hop further out:

      sdk-react -> sdk-core -> core -> db -> postgres, drizzle-orm

  Bundling was already safe, because sdk-core imports core with `import type` and
  those erase. The install was not: `npm i @usegraft/sdk-react` still downloaded
  `postgres` and `drizzle-orm`, which is the exact complaint that fix opens with.
  cubic kept the thread open on the pull request and was right to.

  `npm i @usegraft/sdk-react` now pulls one external package, `zod`.

  Every package that reaches core's database-backed modules at runtime already
  declares `@usegraft/db` directly (`cli`, `compiler`, `mcp`, `studio`, and the
  five server adapters), so nothing needs a new dependency. The packages that
  depend on core without it — `auth`, `content-migrations`, `sdk-react` — import
  only types. If you depend on `@usegraft/core` directly and call
  `defineDataMigration`, `records`, or the functions handler, add
  `@usegraft/db` to your own dependencies.

- 36d6045: Fix the install command on every package page. `npx graft` resolves to an
  unrelated package on npm, so the documented way to run the CLI without
  installing fetched the wrong thing. It is `npx @usegraft/cli` everywhere now,
  with a note saying why the scoped name is needed.

  Fix the `graftRoute` example in `@usegraft/sdk-astro`. It showed a config
  object, but `graftRoute` takes the handler, so the snippet did not compile.

  Document the static index in the SDK READMEs. `createClient` and `createGraft`
  both accept `index` from `openStaticIndex(".graft/index.db")`, which is what
  `graft init` scaffolds by default, and none of the READMEs mentioned it. Every
  read example now shows where its `db` or `index` comes from instead of leaving
  the handle undefined.

  `@usegraft/sdk-sveltekit` gets the same treatment, and its README ships in this
  release. It was `private` and so could not be named in a changeset at all. It
  is public now, at the same version as the rest of the workspace.

- Updated dependencies [2561b47]
- Updated dependencies [15568eb]
- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [a442299]
  - @usegraft/core@1.0.0-beta.0
  - @usegraft/contracts@1.0.0-beta.0
  - @usegraft/db@1.0.0-beta.0

## 0.2.0

### Minor Changes

- f423a6e: Every package ships a README, a description, keywords and a LICENSE.

  `0.1.1` published sixteen packages with no README and, for fourteen of them, no
  `description` either. On npm that renders as a blank page and an unsearchable
  listing: `description` is the line npm search shows, and without keywords the
  packages are findable only by exact name.

  Each README says what the package is, how to install it, and shows one real
  example using its actual exports. The security-relevant ones state their
  defaults plainly, because "MdxBody refuses executable MDX by default" is
  something a reader should not have to find in an ADR.

  `LICENSE` is now copied into each package. `files: ["dist"]` does not exclude
  `README.md` or `LICENSE` (npm always packs those), but a licence file only ships
  if it exists in the package directory, and the root one does not count.

### Patch Changes

- Updated dependencies [61b9ac4]
- Updated dependencies [02690dd]
- Updated dependencies [e0d4eda]
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
- Updated dependencies [52d7488]
- Updated dependencies [d6cbc3d]
  - @usegraft/contracts@0.2.0
  - @usegraft/core@0.2.0
  - @usegraft/db@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/contracts@0.1.1
- @usegraft/core@0.1.1
- @usegraft/db@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/contracts@0.1.0
  - @usegraft/db@0.1.0
