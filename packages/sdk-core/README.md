# @usegraft/sdk-core

> Framework-agnostic typed read client over the content index, plus the cache-tag contract.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-core@beta
```

Most apps use a framework adapter instead: [`@usegraft/sdk-next`](https://www.npmjs.com/package/@usegraft/sdk-next), [`@usegraft/sdk-astro`](https://www.npmjs.com/package/@usegraft/sdk-astro), or [`@usegraft/sdk-sveltekit`](https://www.npmjs.com/package/@usegraft/sdk-sveltekit). Reach for this package directly when yours has no adapter yet.

## Read, with no database

`graft compile` writes the index to a SQLite artifact. Point the client at it and nothing else has to be running.

```ts
import { openStaticIndex } from "@usegraft/db";
import { createClient } from "@usegraft/sdk-core";
import { collections } from "./graft.config";

const index = await openStaticIndex(".graft/index.db");
const graft = createClient({ index, collections });

const page = await graft.getDocument("pages", "home");
const posts = await graft.listDocuments("posts", { limit: 10 });
const hits = await graft.searchDocuments("posts", "postgres");
```

Return types are derived from your collection schemas. There is no codegen step.

## Read from Postgres

Use `createDbClient` from the `/db` entry point. Everything above is unchanged.

```ts
import { createDb } from "@usegraft/db";
import { createDbClient } from "@usegraft/sdk-core/db";
import { collections } from "./graft.config";

const graft = createDbClient({ db: createDb(process.env.DATABASE_URL!).db, collections });
```

`createClient` itself takes only an `index`, and that is deliberate. Accepting a
`db` handle there meant this package imported `@usegraft/db` for its value,
which put `postgres` and `drizzle-orm` into the dependency graph of everything
downstream — including [`@usegraft/sdk-react`](https://www.npmjs.com/package/@usegraft/sdk-react),
a browser package whose whole premise is that a database never reaches a bundle.
The database edge lives behind `/db`, and `@usegraft/db` is an optional peer
dependency: a server install has it, a browser install does not.

Add `branch` to read from a preview branch, on either backend.

## Read from a remote `graft serve`

`createContentApiReader` implements the same `index` seam. Every SDK package keeps its existing `createClient` / `createGraft` surface; only the transport changes. The endpoint is fixed to the server's branch, so a caller cannot switch a production read to preview content.

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
```

This client is server-only. It holds a database handle, an open SQLite file, or a remote endpoint, so never import it into browser code.

## Cache tags

The tag helpers are a contract, not a wrapper. Your app decides where caching happens. These say what to tag and what to invalidate.

```ts
import { tagsFor, documentTag, collectionTag, tagsForChanges } from "@usegraft/sdk-core";

// tag a cached read
cacheTag(...tagsFor(branch, "pages", "home"));

// after a compile, invalidate exactly what changed
const tags = tagsForChanges(branch, changes);
```

`tagsForChanges` takes the `ChangeSet` a compile returns, so a run that touched one document invalidates one document.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-core/CHANGELOG.md)
