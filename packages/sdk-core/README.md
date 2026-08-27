# @usegraft/sdk-core

> Framework-agnostic typed read client over the content index, plus the cache-tag contract.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-core
```

Most apps use a framework adapter instead: [`@usegraft/sdk-next`](https://www.npmjs.com/package/@usegraft/sdk-next) or [`@usegraft/sdk-astro`](https://www.npmjs.com/package/@usegraft/sdk-astro). Reach for this package directly when yours has no adapter yet.

## Read

```ts
import { createClient } from "@usegraft/sdk-core";
import { collections } from "./graft.config";

const graft = createClient({ db, collections });

const page = await graft.getDocument("pages", "home");
const posts = await graft.listDocuments("posts", { limit: 10 });
const hits = await graft.searchDocuments("posts", "postgres");
```

Return types are derived from your collection schemas.

## Cache tags

The tag helpers are a contract, not a wrapper. Your app decides where caching happens; these say what to tag and what to invalidate.

```ts
import { tagsFor, documentTag, collectionTag, tagsForChanges } from "@usegraft/sdk-core";

// tag a cached read
cacheTag(...tagsFor(branch, "pages", "home"));

// after a compile, invalidate exactly what changed
const tags = tagsForChanges(branch, changes);
```

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/sdk-core/CHANGELOG.md)
