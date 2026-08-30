---
"@usegraft/sdk-tanstack-start": patch
"@usegraft/sdk-react-router": patch
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
a server function or a server route, never in a loader. Astro frontmatter and
SvelteKit's `load` are server-side by default and needed no such caveat.

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
