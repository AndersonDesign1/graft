# @usegraft/sdk-core

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
