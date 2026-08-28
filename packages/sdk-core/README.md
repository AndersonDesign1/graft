# @usegraft/sdk-core

> Framework-agnostic typed read client over the content index, plus the cache-tag contract.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-core
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

Pass `db` instead of `index`. Everything above is unchanged.

```ts
import { createDb } from "@usegraft/db";
import { createClient } from "@usegraft/sdk-core";
import { collections } from "./graft.config";

const graft = createClient({ db: createDb(process.env.DATABASE_URL!).db, collections });
```

Pass both and `index` wins. Add `branch` to read from a preview branch, on either backend.

This client is server-only. It holds a database handle or an open SQLite file, so never import it into browser code.

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

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/sdk-core/CHANGELOG.md)
