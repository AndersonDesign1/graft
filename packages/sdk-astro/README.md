# @usegraft/sdk-astro

> Astro adapter: typed content reads and endpoint mounts over the same handlers every other surface serves.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-astro
```

## Read content

Build the handle once in a server-only module, then import it from frontmatter, endpoints, and middleware. Never from a client island: it holds a database handle.

```ts
// src/lib/graft.ts
import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-astro";
import { collections } from "../../graft.config";

export const graft = createGraft({ db: createDb(process.env.DATABASE_URL!).db, collections });
```

```astro
---
// src/pages/[slug].astro
import { graft } from "../lib/graft";

const page = await graft.getContent("pages", Astro.params.slug!);
---
```

Return types come from your `defineCollection` schemas, so a renamed field is a build error rather than a runtime `undefined`.

There is no request-level memo here, because `React.cache` has no Astro equivalent. Reads go straight to the index, which is the right default: prerendered pages read at build time, and an SSR page makes a handful of reads.

## Read with no database

Pass `index` instead of `db` and the same surface reads the SQLite artifact `graft compile` writes.

```ts
import { openStaticIndex } from "@usegraft/db";

export const graft = createGraft({
  index: await openStaticIndex(".graft/index.db"),
  collections,
});
```

## Mount the runtime

`graftRoute` binds a Graft handler to an Astro endpoint, so typed functions and MCP are served from your own app rather than a separate process. It takes the handler, not a config object: Astro hands over an `APIContext`, and the handlers want its `request`.

```ts
// src/pages/api/fn/[name].ts
import { createFunctionsHandler } from "@usegraft/core";
import { graftRoute } from "@usegraft/sdk-astro";

const handler = createFunctionsHandler({ db, collections, functions });

export const POST = graftRoute(handler);
export const GET = graftRoute(handler); // 405s with Allow and a fix
```

```ts
// src/pages/api/mcp.ts
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftRoute } from "@usegraft/sdk-astro";

export const POST = graftRoute(createGraftMcpHandler({ db, collections, functions, actor }));
```

The parameter is typed structurally as `{ request: Request }`, so this package needs no `astro` dependency and every `APIContext` satisfies it.

## MDX

Bodies come back as authored source. Render them with Astro's own MDX pipeline rather than a runtime evaluator, which is why this package ships no `MdxBody` equivalent.

## Cache invalidation

Astro has no tag-based data cache, so the [`@usegraft/sdk-core`](https://www.npmjs.com/package/@usegraft/sdk-core) tag contract maps onto HTTP. Stamp `tagsFor(...)` into a CDN surrogate-key header on SSR responses, and purge `tagsForChanges(branch, changeSet)` from your compile webhook.

```astro
---
Astro.response.headers.set("Cache-Tag", tagsFor(branch, "pages", slug).join(","));
---
```

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/sdk-astro/CHANGELOG.md)
