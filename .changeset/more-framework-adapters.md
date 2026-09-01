---
"@usegraft/sdk-tanstack-start": patch
"@usegraft/sdk-react-router": patch
"@usegraft/sdk-react": patch
---

Add `@usegraft/sdk-tanstack-start`. Same `createGraft` surface as every other
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
