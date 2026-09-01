# @usegraft/sdk-sveltekit

> SvelteKit adapter: typed content reads and endpoint mounts over the same handlers every other surface serves.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-sveltekit@beta
```

## Read content

Build the handle in `$lib/server/`, so SvelteKit's server-only enforcement guards it. This client holds a database handle and must never reach the browser.

```ts
// src/lib/server/graft.ts
import { DATABASE_URL } from "$env/static/private";
import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-sveltekit";
import { collections } from "../../../graft.config";

export const graft = createGraft({ db: createDb(DATABASE_URL).db, collections });
```

```ts
// src/routes/[slug]/+page.server.ts
import { error } from "@sveltejs/kit";
import { graft } from "$lib/server/graft";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const page = await graft.getContent("pages", params.slug);
  if (!page) error(404);
  return { page };
};
```

Return types come from your `defineCollection` schemas, so a renamed field is a build error rather than a runtime `undefined`.

There is no request-level memo here, because `React.cache` has no SvelteKit equivalent. Reads go straight to the index from server `load` functions and `+server.ts` endpoints.

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

`graftRoute` binds a Graft handler to a `+server.ts` endpoint, so typed functions and MCP are served from your own app rather than a separate process. It takes the handler, not a config object: SvelteKit hands over a `RequestEvent`, and the handlers want its `request`.

```ts
// src/routes/api/fn/[name]/+server.ts
import { createFunctionsHandler } from "@usegraft/core";
import { graftRoute } from "@usegraft/sdk-sveltekit";

const handler = createFunctionsHandler({ db, collections, functions });

export const POST = graftRoute(handler);
export const GET = graftRoute(handler); // 405s with Allow and a fix
```

```ts
// src/routes/api/mcp/+server.ts
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftRoute } from "@usegraft/sdk-sveltekit";

export const POST = graftRoute(createGraftMcpHandler({ db, collections, functions, actor }));
```

The parameter is typed structurally as `{ request: Request }`, so this package needs no `@sveltejs/kit` dependency and every `RequestEvent` satisfies it.

## MDX

Bodies come back as authored source. Render them with mdsvex or your own pipeline rather than a runtime evaluator, which is why this package ships no `MdxBody` equivalent.

## Cache invalidation

SvelteKit has no tag-based data cache, so the [`@usegraft/sdk-core`](https://www.npmjs.com/package/@usegraft/sdk-core) tag contract maps onto HTTP. Stamp `tagsFor(...)` into a CDN surrogate-key header with `setHeaders` in `load`, and purge `tagsForChanges(branch, changeSet)` from your compile webhook.

```ts
export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const page = await graft.getContent("pages", params.slug);
  setHeaders({ "Cache-Tag": tagsFor("main", "pages", params.slug).join(",") });
  return { page };
};
```

## Bundling

`node:sqlite` backs the static index and must stay external to the client bundle. Keeping the handle in `$lib/server/` is what guarantees that.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-sveltekit/CHANGELOG.md)
