# @usegraft/content-api

> A versioned, read-only HTTP transport for Graft's authored content index.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/content-api
```

## Serve authored content

`graft serve` mounts this handler at `/api/content/v1`. You can also mount it in any runtime that accepts Web `Request` and `Response` objects.

```ts
import { createContentApiHandler } from "@usegraft/content-api";
import { createDb, createDbIndexReader } from "@usegraft/db";
import { collections } from "./graft.config";

const database = createDb(process.env.DATABASE_URL!);

export const GET = createContentApiHandler({
  collections: Object.keys(collections),
  branch: "main",
  index: createDbIndexReader(database.db),
});
```

The handler serves:

- `GET /api/content/v1/documents?collection=pages`
- `GET /api/content/v1/documents?collection=pages&slug=home`
- `GET /api/content/v1/search?collection=pages&query=pricing`

An endpoint represents one branch. It does not accept a branch query parameter, so a caller cannot switch a production endpoint to preview content.

The handler does not authenticate callers. Put a proxy or check Authorization before invoking it if the index is not public. The handler does not close its reader or database. The application that created those handles owns their lifecycle.

## Use the existing typed SDK

The remote reader implements `ContentIndexReader`, so the framework-agnostic client and framework adapters need no HTTP-specific API.

```ts
import { createContentApiReader } from "@usegraft/content-api";
import { createClient } from "@usegraft/sdk-core";
import { collections } from "./graft.config";

const graft = createClient({
  index: createContentApiReader({
    endpoint: "https://cms.example.com/api/content/v1",
    headers: { authorization: `Bearer ${process.env.GRAFT_CONTENT_TOKEN}` },
  }),
  collections,
});

const page = await graft.getDocument("pages", "home");
const hits = await graft.searchDocuments("pages", "pricing");
```

Pass `fetch` to `createContentApiReader` when the runtime needs a custom implementation. `headers` are static and sent on every request, which suits an auth token or proxy header.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft)
