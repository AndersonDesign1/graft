# Nuxt, Nitro and SvelteKit adapters (research, 2026-11-01)

**Status: plan agreed, nothing built yet.** This note records where each
framework stands today, what a spike proved, and the order to build in.

Each claim is labeled: **verified** (run in the spike below), **registry**
(read from the npm registry on 2026-11-01), or **inferred** (from reading
docs or code, not run).

## Where each framework stands

| Framework          | Current stable                       | Server layer                         | Graft today                     |
| ------------------ | ------------------------------------ | ------------------------------------ | ------------------------------- |
| SvelteKit          | `@sveltejs/kit` 3.1.1 (2026-10-29)   | Its own, Web-standard `RequestEvent` | `@usegraft/sdk-sveltekit` ships |
| Nuxt               | `nuxt` 4.6.3 (2026-10-27)            | `nitropack` 2.13.5 on `h3` 1.15      | Nothing                         |
| Nuxt 5             | Not released, no date                | `nitro` 3 on `h3` 2                  | Nothing                         |
| Nitro (standalone) | `nitro` 3.0.261029-rc (`latest` tag) | `h3` 2.0.8, stable since 2.0.1       | Nothing                         |

All versions above are **registry**. Notes:

- The Nitro rebuild is real and nearly finished. `nitropack` was renamed to
  `nitro`, `nitropack/runtime/*` became `nitro/*`, `eventHandler` became
  `defineHandler`, and the request is now a Web `Request` on `event.req`.
  The v3 beta was announced on 2026-03-11. The release candidate landed on
  2026-10-29 and npm's `latest` tag now points at it. It needs Node.js
  22.22.0 or newer. Versions are calendar-based (`3.0.YYMMDD-rc`).
- `h3` 2 is stable (2.0.8 on 2026-10-22). Waiting on h3 is no longer a reason
  to wait.
- Nuxt 4.6 still runs `nitropack` 2 and `h3` 1 (from the
  `@nuxt/nitro-server` 4.6.3 manifest). Nuxt 5 moves to `nitro` 3 and `h3` 2.
  So a Nuxt adapter built now must work on both for at least a year: Nuxt 4
  reaches end of life six months after Nuxt 5 ships.
- TanStack Start already deploys through Nitro. `@usegraft/sdk-tanstack-start`
  mounts through its own server routes and does not need anything from this
  note.

## What the spike proved

The spike lives outside the repo. Rerun it from an empty folder with the
commands below.

### One mount covers h3 1 and h3 2 (verified)

A stand-in Graft handler (`Request` in, a streamed `text/event-stream`
`Response` out, the shape MCP Streamable HTTP uses) was mounted three ways.

```sh
npm i h3v1@npm:h3@1.15.11 h3v2@npm:h3@2.0.8
```

```js
// h3 1 (Nuxt 4): build the Request, return the Response.
app1.use(
  "/api/mcp",
  v1.eventHandler((e) => graft(v1.toWebRequest(e))),
);
// h3 2 (Nuxt 5, Nitro 3): event.req is already the Request.
new H3().all("/api/mcp", (e) => graft(e.req));
```

```
h3 v1: 201 text/event-stream 1 "event: msg\ndata: {\"m\":\"POST\",\"path\":\"/api/mcp\",\"body\":\"{\\\"x\\\":1}\",\"auth\":\"Bearer t\"}\n\n"
h3 v2: 201 text/event-stream 1 "event: msg\ndata: {\"m\":\"POST\",\"path\":\"/api/mcp\",\"body\":\"{\\\"x\\\":2}\",\"auth\":\"Bearer t\"}\n\n"
v1 event.req is Request? false | has toWebRequest: function
```

Status, headers, the POST body, the `Authorization` header and a streamed
body all survive on both. On h3 1, `event.req` is not a `Request`, so the
mount has to tell the two apart.

### A real Nitro 3 build serves it (verified)

```sh
npm i nitro@3.0.261029-rc
```

```ts
// routes/api/mcp.ts
import { defineHandler } from "nitro/h3";
export default defineHandler((event) => graft(event.req));
```

`npx nitro build` produced a 70.7 kB `node-server` output in 427 ms, and
`node .output/server/index.mjs` answered:

```
$ curl -X POST localhost:39411/api/mcp -d '{"jsonrpc":"2.0"}'
{"m":"POST","path":"/api/mcp","body":"{\"jsonrpc\":\"2.0\"}"} [201]
```

### The SvelteKit adapter fits SvelteKit 3 (verified)

`packages/sdk-sveltekit/src/routes.ts`, copied unchanged, type-checks against
`@sveltejs/kit` 3.1.1 with TypeScript 6.0.3:

```ts
import type { RequestHandler } from "@sveltejs/kit";
export const POST: RequestHandler = graftRoute(async (r) => new Response(r.method));
```

SvelteKit 3 moved the `RequestEvent` import to `$app/server` and made its
properties readonly. Neither touches `graftRoute`, because it is typed
structurally as `{ request: Request }`. SvelteKit 3 requires TypeScript 6,
which the workspace already uses.

## The plan (agreed 2026-11-01)

Decisions:

- Two server packages: `@usegraft/sdk-nitro` (reads and the mount) and
  `@usegraft/sdk-nuxt` (a Nuxt module on top).
- A browser client, `@usegraft/sdk-vue`, that stands to sdk-nuxt the way
  `@usegraft/sdk-react` stands to sdk-next.
- Nuxt 4 and Nuxt 5 are both supported.
- Vue renders MDX the way sdk-next does. Svelte gets an AST renderer.
- The Nitro module for headless deploys waits until Nitro 3 is stable.
- One PR per unit, in the order below. Each one is verified on its own.

### 1. `@usegraft/sdk-nitro`: typed reads and one mount

The same `createGraft` surface every adapter has, plus a mount for any h3
event handler:

```ts
// server/routes/api/mcp.post.ts (Nuxt 4 or 5) or routes/api/mcp.post.ts (Nitro)
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftHandler } from "@usegraft/sdk-nitro";

export default defineEventHandler(graftHandler(createGraftMcpHandler({ … })));
```

`graftHandler` returns `(event) => Promise<Response>`. It finds the
`Request` in this order, with no dependency on `h3`, `nitro` or `nitropack`:

1. `event.req` when it is a `Request` (h3 2).
2. `event.web.request` when present (h3 1 on a Web runtime, inferred from
   the h3 1 source).
3. A `Request` built from `event.node.req` (h3 1 on Node).

Step 3 is what `createNodeListener` in `packages/cli/src/commands/serve.ts`
already does. Move that conversion into a shared module and use it from
both, so there is one Node-to-`Request` path rather than two.

Returning a `Response` from an event handler works on h3 1 and h3 2
(verified above). The tests mount a real handler on h3 1 and h3 2, the way
the spike did. This PR also commits this note.

### 2. `@usegraft/sdk-vue`: the browser client

`createGraft({ endpoint, collections })` over `@usegraft/content-api`,
returning the same three reads as every adapter. On top sit composables that
run those reads and report `{ data, error, loading, refresh }` as refs:
`useContent`, `useContentList` and `useContentSearch`. They come out of a
factory, `createGraftComposables(graft)`, for the same reason sdk-react's
hooks do. A composable reading an untyped injection could only promise
`Document<AnyCollection>`.

Same limits as sdk-react: a binding, not a cache, and `branch` with
`endpoint` is a `CONFIG_INVALID` at construction.

`<GraftMdx>` renders a body with `@mdx-js/mdx` on Vue's JSX runtime
(`jsxImportSource: "vue"`). It uses the same `trust` default
(`"restricted"`, through `assertSafeMdx`) and the same safe-URL rehype pass
as `MdxBody`. That pass lives in `packages/sdk-next/src/safe-urls.ts` today.
Move it somewhere both packages can import rather than copying it. The Vue
JSX runtime path is inferred and gets proved first in this PR.

### 3. `@usegraft/sdk-nuxt`: a Nuxt module over sdk-nitro and sdk-vue

Nuxt users expect a module in `nuxt.config.ts`, not hand-written routes:

```ts
export default defineNuxtConfig({
  modules: ["@usegraft/sdk-nuxt"],
  graft: { routes: { mcp: true, functions: true } },
});
```

What the module does:

- Adds a server-only `useGraft()` to `server/utils`, built from
  `runtimeConfig.graft.databaseUrl` (`NUXT_GRAFT_DATABASE_URL`) or the static
  index.
- Registers `/api/mcp` and `/api/fn/[name]` through sdk-nitro when asked.
- Auto-imports the sdk-vue composables and `<GraftMdx>` for pages.
- Says the same thing about isolation that the TanStack Start adapter says
  about loaders. A Nuxt page's `<script setup>` runs on the server for the
  first paint and in the browser on navigation. The database handle belongs
  in `server/`, and pages read through the sdk-vue client or a server route
  (inferred from Nuxt's rendering model).

The module uses only `@nuxt/kit` calls that exist in Nuxt 4 and 5
(`addServerHandler`, `addServerImportsDir`, `addImports`, `addComponent`),
inferred. Two compat apps prove it: one on Nuxt 4 and one on the Nuxt 5
prerelease, added as soon as one is published.

### 4. SvelteKit 3 compat app

A compat app pinned to SvelteKit 3, like `packages/sdk-next/compat`, so a
SvelteKit release that breaks the mount fails CI instead of a user. The
README and docs page then say SvelteKit 3 is supported.

### 5. `graft create --framework sveltekit|nuxt`

Today the flag accepts `next|none` (`packages/cli/src/registry.ts`,
`packages/cli/src/create/scaffold.ts`). Add `sveltekit` and `nuxt`, each a
site that shows every collection, like the Next.js one. Rebuild the CLI and
run `pnpm docs:cli` afterwards.

### 6. Svelte MDX renderer

Svelte has no JSX runtime, and mdsvex is a different dialect, not MDX. Compile
the body to an AST and render it with a small recursive Svelte component
that maps element names to an allowlisted component map. It never evaluates
the body, so `{expr}` and `import` stay refused under every trust level. Say
that difference from `MdxBody` in the docs.

### Later: a Nitro module that runs `graft serve` anywhere Nitro deploys

`graft serve` binds the runtime to `node:http`, so a headless deploy today
means a Node host. The same routes registered as a Nitro module get Nitro's
deploy presets: Vercel, Netlify, Cloudflare, Deno, Bun, AWS Lambda and more.
Waiting for Nitro 3 to leave RC. Limits to test before promising anything
(all inferred):

- The static index uses `node:sqlite`. It works on Node presets. Treat edge
  presets as Postgres-only until tested.
- `@usegraft/db` uses the `postgres` driver over TCP. Cloudflare Workers need
  `nodejs_compat` and probably Hyperdrive.
- `/healthz` and the route map must stay byte-identical to `graft serve`.
  Mount the same router (`createServeRouter`) rather than re-declaring
  routes.

## Wiring every new package needs

From the repo's own checks, so none of these is optional:

- An entry in `PACKAGE_KNOWLEDGE` in `packages/mcp/src/packages.ts`, and
  `"nuxt" | "nitro" | "vue"` in its `framework` union. A test fails if a published
  package is missing.
- The package list in `.github/workflows/pr.yml`.
- The README framework table and the package table.
- A docs page under `examples/docs-site/content/docs/`.
- A changeset, and coverage floors for the new package.
