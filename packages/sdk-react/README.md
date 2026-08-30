# @usegraft/sdk-react

> The browser client: typed content reads and hooks over Graft's read-only content API.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

Every other Graft SDK reads on a server. This one reads in the browser, for the places a loader cannot help: a search box, a client-side editor preview, a widget on a page the server rendered an hour ago.

## Install

```bash
npm i @usegraft/sdk-react
```

`react` is a peer dependency, 18 or 19.

## Types do not cross the wire

Your app imports its own `collections` from `graft.config.ts` at compile time, exactly as a server adapter does. The endpoint supplies data at runtime. Nothing is generated, nothing is fetched to be typed, and `getContent("docs", slug)` returns the document type your schema declares.

```ts
// src/graft.ts
import { createGraft, createGraftHooks } from "@usegraft/sdk-react";
import { collections } from "../graft.config";

export const graft = createGraft({
  endpoint: "https://cms.example.com/api/content/v1",
  collections,
});

export const { GraftProvider, useGraft, useContent, useContentList, useContentSearch } =
  createGraftHooks(graft);
```

The hooks come out of a factory rather than being importable directly, and that is what keeps the reads typed. A hook reading an untyped context could only promise `Document<AnyCollection>` — `data.title` would be `unknown` and a misspelled collection name would be a runtime surprise instead of a compile error. Binding the factory to your collections once buys typed reads everywhere.

## Serve the endpoint

`endpoint` points at a mount of Graft's read-only content API — what `graft serve` exposes at `/api/content/v1`, or your own mount of `createContentApiHandler` from [`@usegraft/content-api`](https://www.npmjs.com/package/@usegraft/content-api). It answers document reads and search, nothing else: no functions, no writes, no schema.

An endpoint is pinned to one branch on the server side, which is why there is no `branch` option to pass with `endpoint`. Point at the preview deployment's endpoint to read a preview branch.

## Read

```tsx
import { useContent, useContentSearch } from "../graft";

function Doc({ slug }: { slug: string }) {
  const { data, error, loading } = useContent("docs", slug);

  if (loading) return <Spinner />;
  if (error) return <Problem error={error} />;
  if (!data) return <NotFound />;
  return <article>{data.data.title}</article>;
}
```

Each hook reports `{ data, error, loading, refresh }`. `data` answers the current arguments or it is `undefined`: changing the slug clears it rather than showing the previous document while the next one loads.

`useContentList(collection, options?)` and `useContentSearch(collection, query, options?)` are the same shape over `listContent` and `searchContent`.

## What this is not

It is not a cache. There is no deduplication, no retry, no background refresh, no stale-while-revalidate — a read starts when its arguments change and reports one answer. Your app almost certainly has TanStack Query or SWR already, both of which do that properly, and `graft.getContent` is a plain async function that composes with either:

```ts
useQuery({
  queryKey: ["docs", slug],
  queryFn: () => graft.getContent("docs", slug),
});
```

Shipping a worse copy of a query client inside an SDK is the wrong trade, so the hooks stay a binding and the caching stays yours.

It is also not a server renderer. `useEffect` does not run during server rendering, so on the server these hooks report their loading state and nothing else. Content that has to be in the HTML belongs in a loader or a server adapter: [`@usegraft/sdk-next`](https://www.npmjs.com/package/@usegraft/sdk-next), [`sdk-astro`](https://www.npmjs.com/package/@usegraft/sdk-astro), [`sdk-sveltekit`](https://www.npmjs.com/package/@usegraft/sdk-sveltekit), [`sdk-react-router`](https://www.npmjs.com/package/@usegraft/sdk-react-router), [`sdk-tanstack-start`](https://www.npmjs.com/package/@usegraft/sdk-tanstack-start).

## Point a subtree somewhere else

`GraftProvider` is optional — the hooks fall back to the handle the factory was built with. Mount one to override it for a subtree: a preview branch's endpoint, or a fake in tests.

```tsx
<GraftProvider graft={previewGraft}>
  <Preview />
</GraftProvider>
```

## Without hooks

`createGraft` is useful on its own. It returns `getContent` / `listContent` / `searchContent` and the underlying `client`, all typed the same way, for event handlers, a query client, or anywhere React is not involved.

## Bring your own transport

Pass `index` instead of `endpoint` to read through any `ContentIndexReader` — a configured `createContentApiReader`, a service-worker-backed reader, or a fake in a test.

```ts
import { createContentApiReader } from "@usegraft/sdk-react";

export const graft = createGraft({
  index: createContentApiReader({ endpoint, headers: { Authorization: `Bearer ${token}` } }),
  collections,
});
```

There is no `db` option, and no `graftRoute`. A database handle in a browser bundle is a database URL in a browser bundle, and mounting a request handler is a server's job.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-react/CHANGELOG.md)
