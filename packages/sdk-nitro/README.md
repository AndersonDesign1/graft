# @usegraft/sdk-nitro

> Nitro adapter, for Nuxt 4, Nuxt 5 and standalone Nitro 3: typed content reads and event-handler mounts over the same handlers every other surface serves.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-nitro
```

| You run            | Server underneath   |
| ------------------ | ------------------- |
| Nuxt 4             | nitropack 2 on h3 1 |
| Nuxt 5             | Nitro 3 on h3 2     |
| Nitro 3 on its own | h3 2                |

One package covers all three. It is typed structurally, so it depends on no Nuxt, Nitro or h3 version.

## Read content

Build the handle in `server/utils/`, so it never reaches the browser. Open it on first use: Nuxt 4 compiles server code to ES2019, which has no top-level await.

```ts
// server/utils/graft.ts
import { openStaticIndex } from "@usegraft/db";
import { createGraft, type Graft } from "@usegraft/sdk-nitro";
import { collections } from "../../graft.config";

let graft: Promise<Graft<typeof collections>> | undefined;

export function useGraft(): Promise<Graft<typeof collections>> {
  graft ??= openStaticIndex(".graft/index.db")
    .then((index) => createGraft({ index, collections }))
    .catch((error: unknown) => {
      // Forget a failed open, so the next request tries again.
      graft = undefined;
      throw error;
    });
  return graft;
}
```

```ts
// server/api/pages/[slug].get.ts
export default defineEventHandler(async (event) => {
  const page = await (await useGraft()).getContent("pages", getRouterParam(event, "slug") ?? "");
  if (!page) throw createError({ statusCode: 404 });
  return page;
});
```

Return types come from your `defineCollection` schemas, so a renamed field is a build error rather than a runtime `undefined`. For Postgres, pass `db` instead of `index`.

A Nuxt page's `<script setup>` also runs in the browser, so pages fetch through a server route like the one above, never by importing the handle.

## Mount the runtime

`graftHandler` turns a Graft handler into a Nitro event handler, so typed functions and MCP are served from your own app.

```ts
// server/api/mcp.ts
import { resolve } from "node:path";
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftHandler } from "@usegraft/sdk-nitro";

const contentDir = resolve(process.cwd(), "content");

export default defineEventHandler(
  graftHandler(createGraftMcpHandler({ contentDir, db, collections, functions, actor })),
);
```

It reads the request from `event.req` on h3 2 and builds it from `event.node.req` on h3 1. On h3 1 it finds the body where h3 itself would. That includes a page calling its own route with `$fetch` during server rendering, which Nuxt 4 answers without a network hop. The body streams to the handler, so each handler's own size limit applies, and anything past 32 MiB is refused with `413` (`graftHandler(handler, { maxBodyBytes })` changes that).

## Rate limits count the real caller

Nitro hands the adapter the connection, so `graftHandler` records the caller's socket address for Graft's rate limits. When Nitro exposes that address, anonymous callers each get their own limit; when it doesn't, they share one, as on other frameworks. The address comes from the connection, never from a header, so behind a proxy every caller shares the proxy's address. Set `trustedProxyHops` on the handler that rate-limits (`createFunctionsHandler` or `createContentApiHandler`) to count the client behind it.

## Cache invalidation

Nitro has no tag-based data cache, so the [`@usegraft/sdk-core`](https://www.npmjs.com/package/@usegraft/sdk-core) tag contract maps onto HTTP. Stamp `tagsFor(...)` into a CDN surrogate-key header with `setResponseHeader`, and purge `tagsForChanges(branch, changeSet)` from your compile webhook.

## MDX

Bodies come back as authored source. Render them with your own pipeline.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-nitro/CHANGELOG.md)
