---
"@usegraft/sdk-tanstack-start": patch
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
