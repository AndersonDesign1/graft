---
"@usegraft/sdk-nitro": patch
"@usegraft/mcp": patch
---

Add `@usegraft/sdk-nitro`, the adapter for Nuxt 4, Nuxt 5 and standalone
Nitro 3. Same `createGraft` surface as every other adapter, so
`getContent("pages", slug)` returns the type your `defineCollection` declared,
plus `graftHandler` for mounting the functions and MCP handlers on a Nitro
event handler.

```ts
// server/api/mcp.ts
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftHandler } from "@usegraft/sdk-nitro";

export default defineEventHandler(
  graftHandler(createGraftMcpHandler({ db, collections, functions, actor })),
);
```

Two h3 majors are in use at once. Nuxt 4 runs nitropack 2 on h3 1, whose event
wraps a Node request. Nitro 3 and Nuxt 5 run h3 2, whose `event.req` is already
a Web `Request`. `graftHandler` takes either, and is typed structurally, so the
package depends on no Nuxt, Nitro or h3 version. On h3 1 it finds the body the
way h3 itself does. That matters when a Nuxt 4 page calls its own route with
`$fetch` during server rendering: nitropack answers that call in-process, with
the body on `req.body` and a stream that never emits it. Reading only the
stream sent the MCP handler an empty body.

On h3 1 under Node the body streams to the Graft handler rather than being
buffered, so each handler's own size limit stops the read. `graftHandler`
refuses a declared length over 32 MiB with `413` `PAYLOAD_TOO_LARGE`, stops a
body that grows past it as the bytes are read, and closes the connection when a
handler answers before reading the whole body. Its `maxBodyBytes` option
changes that ceiling.

This is the first adapter that records the caller's address for rate limits.
Other frameworks hand Graft only the request, so anonymous callers there share
one limit until you set `trustedProxyHops`. Nitro hands over the connection, so
`graftHandler` registers the socket address with `setRequestPeer`, and each
anonymous caller gets its own limit. The address never comes from a header.

Server code on Nuxt 4 compiles to ES2019, which has no top-level await, so
`await openStaticIndex(...)` at the top of a module fails to build. The README
and the new docs page open the index on first use instead.

`list_packages` now accepts `framework: "nitro"` and `framework: "nuxt"`, and
answers both with this package. Its entries gain an optional `alsoFor` list
naming the other frameworks an adapter serves.
