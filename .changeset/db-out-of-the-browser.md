---
"@usegraft/sdk-core": minor
"@usegraft/contracts": minor
"@usegraft/db": minor
"@usegraft/content-api": minor
"@usegraft/sdk-react": patch
"@usegraft/sdk-next": patch
"@usegraft/sdk-astro": patch
"@usegraft/sdk-sveltekit": patch
"@usegraft/sdk-tanstack-start": patch
"@usegraft/sdk-react-router": patch
---

**BREAKING:** `createClient` takes `index` and no longer takes `db`. Pass a
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
