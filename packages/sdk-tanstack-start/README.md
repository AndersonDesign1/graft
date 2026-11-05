# @usegraft/sdk-tanstack-start

> TanStack Start adapter: typed content reads and server-route mounts over the same handlers every other surface serves.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-tanstack-start
```

## Read content

Build the handle once in a server-only module, then reach it from server functions and server routes.

```ts
// src/lib/graft.server.ts
import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-tanstack-start";
import { collections } from "../../graft.config";

export const graft = createGraft({ db: createDb(process.env.DATABASE_URL!).db, collections });
```

```ts
// src/routes/docs.$slug.tsx
import { createServerFn } from "@tanstack/react-start";
import { graft } from "../lib/graft.server";

const getDoc = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(({ data: slug }) => graft.getContent("docs", slug));
```

Return types come from your `defineCollection` schemas, so a renamed field is a build error rather than a runtime `undefined`.

A route `loader` is the wrong place for this handle. TanStack Start loaders are isomorphic: they run on the server for the first paint and in the browser on client-side navigation. A handle that holds a database connection has no business in either the client bundle or the browser, which is what `createServerFn` is for.

There is no request-level memo here, because `React.cache` covers React Server Components and Start is not one. Reads go straight to the index; call sites own memoization.

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

`graftRoute` binds a Graft handler to a server route, so typed functions and MCP are served from your own app rather than a separate process. It takes the handler, not a config object: Start hands the method handler a context object, and the handlers want its `request`.

```ts
// src/routes/api/fn/$name.ts
import { createServerFileRoute } from "@tanstack/react-start/server";
import { createFunctionsHandler } from "@usegraft/core";
import { graftRoute } from "@usegraft/sdk-tanstack-start";

const handler = createFunctionsHandler({ db, collections, functions });

export const ServerRoute = createServerFileRoute("/api/fn/$name").methods({
  POST: graftRoute(handler),
  GET: graftRoute(handler), // 405s with Allow and a fix
});
```

```ts
// src/routes/api/mcp.ts
import { createGraftMcpHandler } from "@usegraft/mcp";
import { graftRoute } from "@usegraft/sdk-tanstack-start";

export const ServerRoute = createServerFileRoute("/api/mcp").methods({
  POST: graftRoute(createGraftMcpHandler({ db, collections, functions, actor })),
});
```

The name of the server-route factory has moved across TanStack Start releases. What has not moved is the handler signature: an object carrying a Web `Request`. That is the whole contract, so the parameter is typed structurally as `{ request: Request }` and this package needs no `@tanstack/react-start` dependency.

## MDX

Bodies come back as authored source. `prepareMdx` turns one into a tree inside a server function, and `MdxContent` renders it with your React components:

```tsx
import { createServerFn } from "@tanstack/react-start";
import { MdxContent } from "@usegraft/sdk-tanstack-start/mdx";
import { prepareMdx } from "@usegraft/sdk-tanstack-start/server";
import { graft } from "./lib/graft.server";

export const getDoc = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const doc = await graft.getContent("docs", slug);
    return doc ? { body: prepareMdx(doc.body) } : null;
  });

// In the route component, with the loader's result:
<MdxContent tree={doc.body} components={{ Callout }} />;
```

The tree is plain data: the server function returns it, and it renders the same on the server and after a client-side navigation. The body is never evaluated, so `{expressions}`, `import`, `export` and spread attributes are refused under every trust level, along with `<script>`-like elements, `on…` handlers and `innerHTML`-style attributes, with a `GraftError` whose code is `INPUT_VALIDATION_FAILED`. Call `prepareMdx` only inside a server function or a server route: it carries the Markdown parser. `/mdx` is safe in the browser.

`graft create --framework tanstack-start` makes a site that renders every collection this way, and serves its build on Node with [srvx](https://srvx.h3.dev).

## Cache invalidation

TanStack Start has no tag-based data cache, so the [`@usegraft/sdk-core`](https://www.npmjs.com/package/@usegraft/sdk-core) tag contract maps onto HTTP. Stamp `tagsFor(...)` into a CDN surrogate-key header on the responses you serve, and purge `tagsForChanges(branch, changeSet)` from your compile webhook.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-tanstack-start/CHANGELOG.md)
