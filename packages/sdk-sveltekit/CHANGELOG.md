# @usegraft/sdk-sveltekit

## 1.0.0-beta.0

### Patch Changes

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

- 3bb7f7b: Publish `@usegraft/sdk-sveltekit`. It sat at `0.1.0` and `private` while every
  other package in the workspace was at `0.2.0`, and `private` is what kept it
  there. The release config puts every `@usegraft/*` package in one `fixed`
  group, and changesets counts a private package as ignored, so naming this one
  beside any other failed the mixed-changeset check and the release plan refused
  to build. That left no way to ship a fix for it at all, and it fell one version
  further behind on each release. It is public at `0.2.0` now and versions with
  everything else.

  Nothing in the package itself changed. The README, the adapter and its tests
  were already written and are untouched. `src/` still tracks
  `@usegraft/sdk-astro`: the same `createGraft` and `graftRoute`, differing only
  in doc comments, the `context` to `event` rename that SvelteKit's
  `RequestEvent` asks for, and the URL one test uses as a fixture. That adapter
  is exercised by `examples/docs-site`, so this code path has been covered all
  along and only the packaging held it back.

  Pin the MinIO images in the self-host Dockerfile to digests. `minio/minio` and
  `minio/mc` were both on `latest`, which MinIO moves on every release, so the
  image the README tells people to `docker run` could change from one build to
  the next while nothing in this repo did, and a bad upstream release would
  arrive with no way to tell what had shifted. Every GitHub Action here is
  already SHA-pinned for that reason.

- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [36d6045]
  - @usegraft/sdk-core@1.0.0-beta.0
  - @usegraft/db@1.0.0-beta.0

## 0.1.0

### Patch Changes

- @usegraft/sdk-core@0.1.0
