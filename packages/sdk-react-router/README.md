# @usegraft/sdk-react-router

> React Router v7 adapter: typed content reads and loader/action mounts over the same handlers every other surface serves.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator. For framework mode, which is where React Router runs loaders and actions on a server.

## Install

```bash
npm i @usegraft/sdk-react-router
```

## Read content

Build the handle once in a `.server.ts` module, then import it from loaders and actions.

```ts
// app/lib/graft.server.ts
import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-react-router";
import { collections } from "../../graft.config";

export const graft = createGraft({ db: createDb(process.env.DATABASE_URL!).db, collections });
```

```ts
// app/routes/docs.$slug.tsx
import { graft } from "../lib/graft.server";
import type { Route } from "./+types/docs.$slug";

export async function loader({ params }: Route.LoaderArgs) {
  return { doc: await graft.getContent("docs", params.slug) };
}
```

Return types come from your `defineCollection` schemas, so a renamed field is a build error rather than a runtime `undefined`.

`loader` and `action` run on the server and React Router strips them from the browser bundle. The `.server.ts` name is belt and braces on top of that: it turns a stray client import into a build error rather than a database URL in a bundle.

There is no request-level memo here, because `React.cache` covers React Server Components and framework mode is not one. Reads go straight to the index, which is the right default: a loader runs once per request and makes a handful of reads.

To read content in the browser instead — a search box, an editor preview — use [`@usegraft/sdk-react`](https://www.npmjs.com/package/@usegraft/sdk-react), which reads the same content over HTTP and needs no database handle.

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

`graftRoute` binds a Graft handler to a resource route — a route module with no default export, whose loader and action return raw Responses — so typed functions and MCP are served from your own app rather than a separate process.

```ts
// app/routes/api.fn.$name.ts
import { createFunctionsHandler } from "@usegraft/core";
import { graftRoute } from "@usegraft/sdk-react-router";

const handler = createFunctionsHandler({ db, collections, functions });

export const action = graftRoute(handler); // POST
export const loader = graftRoute(handler); // GET, which 405s with Allow and a fix
```

```ts
// app/routes/api.mcp.ts
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftRoute } from "@usegraft/sdk-react-router";

export const action = graftRoute(createGraftMcpHandler({ db, collections, functions, actor }));
```

Register them the way you register any route:

```ts
// app/routes.ts
import { route, type RouteConfig } from "@react-router/dev/routes";

export default [
  route("api/fn/:name", "routes/api.fn.$name.ts"),
  route("api/mcp", "routes/api.mcp.ts"),
] satisfies RouteConfig;
```

React Router splits a route by method into two exports rather than naming the method, so one handler is mounted twice. Exporting `loader` is not ceremony: it is what makes a GET to a function endpoint answer with Graft's 405 and its `Allow` header, instead of React Router's own "no loader" error, which teaches the caller nothing.

The parameter is typed structurally as `{ request: Request }`, so this package needs no `react-router` dependency and every `LoaderFunctionArgs`, `ActionFunctionArgs` and generated `Route.LoaderArgs` satisfies it.

## MDX

Bodies come back as authored source. Render them with your own pipeline. The `MdxBody` in [`@usegraft/sdk-next`](https://www.npmjs.com/package/@usegraft/sdk-next) evaluates MDX in a Server Component, which framework mode does not have, so it is not re-exported here.

## Cache invalidation

React Router has no tag-based data cache, so the [`@usegraft/sdk-core`](https://www.npmjs.com/package/@usegraft/sdk-core) tag contract maps onto HTTP. Stamp `tagsFor(...)` into a CDN surrogate-key header from the route's `headers` export, and purge `tagsForChanges(branch, changeSet)` from your compile webhook.

```ts
export function headers() {
  return { "Cache-Tag": tagsFor("main", "docs", slug).join(",") };
}
```

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-react-router/CHANGELOG.md)
