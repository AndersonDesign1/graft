# @usegraft/sdk-react

## 1.0.0-beta.0

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

- fcfa66f: Add `@usegraft/sdk-tanstack-start`. Same `createGraft` surface as every other
  adapter, so `getContent("docs", slug)` returns the type your `defineCollection`
  declared and an unknown collection name is a compile error, plus `graftRoute`
  for mounting the functions and MCP handlers on a server route. Typed
  structurally, so the package depends on no TanStack code and there is no peer
  version to keep in step.

  The framework-specific warning is about loaders. TanStack Start route loaders
  are isomorphic — they run on the server for the first paint and in the browser
  on client-side navigation — so a handle holding a database connection belongs in
  a server function or a server route, never in a loader. Astro frontmatter is
  the only adapter here that is server-side unconditionally; SvelteKit has the
  same split under different names, where a `load` in `+page.server.ts` is
  server-only and a universal `load` in `+page.ts` also runs in the browser.

  Add `@usegraft/sdk-react-router` for React Router v7 framework mode, which
  absorbs the Remix path. Same surface again, with one difference worth knowing
  before you mount anything: React Router splits a route by method into two
  exports instead of naming the method, so a functions endpoint exports both
  `action` (POST) and `loader` (GET). The `loader` line looks redundant and is
  not — without it a GET gets React Router's own "no loader" error rather than
  Graft's 405 with an `Allow` header and a fix.

  Its `graftRoute` test builds a typed `LoaderFunctionArgs`-shaped value rather
  than passing an object literal inline. TypeScript's excess property check
  rejects the literal, which would have made the test assert the opposite of what
  it claims: that the mount accepts only `{ request }`, when the point is that it
  accepts the larger object React Router actually passes.

  Add `@usegraft/sdk-react`, the browser client, which only became coherent once
  `@usegraft/content-api` shipped. The open question was types across the wire,
  and the answer is that they do not cross it: the app imports its own
  `collections` from `graft.config.ts` at compile time exactly as a server adapter
  does, and `createContentApiReader` supplies data over HTTP. No codegen, no
  generated client, no schema fetched at runtime — the wire carries documents.

  `createGraft({ endpoint, collections })` returns the same three reads as every
  other adapter. On top of that sit `createGraftHooks(graft)` and three hooks that
  run those reads and report `{ data, error, loading, refresh }`. The hooks come
  out of a factory rather than being importable directly because that is what
  keeps them typed: a hook reading an untyped context could only promise
  `Document<AnyCollection>`, which makes `data.title` unknown and a misspelled
  collection name a runtime surprise.

  They are a binding, not a cache. No deduplication, no retries, no
  stale-while-revalidate, and `data` answers the current arguments or is
  undefined. Apps have TanStack Query or SWR for that and `graft.getContent` is a
  plain async function that composes with either; a worse copy of a query client
  inside an SDK is the wrong trade.

  Two things this turned up. `branch` is silently dropped over the wire — the
  content API pins its branch server-side and rejects a branch query param, so a
  client that set one would read main while believing it read a preview. Passing
  `branch` with `endpoint` is now a `CONFIG_INVALID` at construction that says to
  point at the preview's own endpoint. And `packages/sdk-react` carries the only
  jsdom config in `packages/`: `useEffect` never runs without a DOM, so a
  Node-environment test of these hooks would have asserted the loading state and
  nothing else — precisely the part that cannot break.

- 655e4d1: Let `endpoint` be a same-origin path, which is what the docs already tell you
  to write.

  `createGraft({ endpoint: "/api/content/v1" })` threw `TypeError: Invalid URL`
  before a single read. `normalizeEndpoint` called bare `new URL(endpoint)` with
  no base, and a relative path has no origin to parse against.

  That form is not a stray idea — it is the example in
  `/docs/reading-content` and in the `createGraft` JSDoc that ships inside
  `@usegraft/sdk-react`. So the first thing a browser reader copied out of the
  documentation crashed at construction. cubic raised it on the pull request.

  A string endpoint now resolves against `location.href` when one exists. An
  absolute endpoint is unchanged, and a `URL` instance is unchanged. Outside a
  browser there is no origin to resolve against, and guessing one would send
  content reads somewhere arbitrary, so a relative path there is refused as
  `CONFIG_INVALID` with that reason rather than a bare `TypeError`.

- Updated dependencies [d5f5567]
- Updated dependencies [15568eb]
- Updated dependencies [1139a88]
- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [655e4d1]
- Updated dependencies [36d6045]
  - @usegraft/content-api@1.0.0-beta.0
  - @usegraft/contracts@1.0.0-beta.0
  - @usegraft/sdk-core@1.0.0-beta.0
