# @usegraft/sdk-astro

> Astro adapter: typed content reads and endpoint mounts over the same handlers every other surface serves.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-astro
```

## Read content

```ts
import { createGraft } from "@usegraft/sdk-astro";
import { collections } from "../graft.config";

const graft = createGraft({ db, collections });
const page = await graft.getContent("pages", Astro.params.slug);
```

## Mount the runtime

`graftRoute` binds Graft's stateless handlers to an Astro endpoint, so typed functions and MCP are served from your own app rather than a separate process.

```ts
// src/pages/api/[...graft].ts
import { graftRoute } from "@usegraft/sdk-astro";

export const ALL = graftRoute({ db, collections, functions });
```

## MDX

Bodies come back as authored source. Render them with Astro's own MDX pipeline rather than a runtime evaluator, which is why this package ships no `MdxBody` equivalent.

## Cache invalidation

The [`@usegraft/sdk-core`](https://www.npmjs.com/package/@usegraft/sdk-core) tag contract maps onto CDN surrogate keys.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/sdk-astro/CHANGELOG.md)
