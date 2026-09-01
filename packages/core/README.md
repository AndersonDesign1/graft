# @usegraft/core

> Schema and typed functions as owned code. `defineCollection`, `field`, `defineFunction`.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/core
```

## Define a collection

Collections are TypeScript you own. There is no hosted schema to click through, and an agent edits this file directly.

```ts
import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  description: "Marketing pages rendered at / and /<slug>.",
  fields: {
    title: field.string({ description: "Page headline." }),
    description: field.string({ maxLength: 160 }),
    order: field.number({ optional: true, int: true }),
  },
});

export const collections = { pages };
```

Field builders bound what they accept: `maxLength` and `pattern` on strings, `min` / `max` / `int` on numbers, `maxItems` on arrays. An unbounded field is an unbounded jsonb column, so the bounds are the point.

## Define a function

```ts
import { defineFunction, listRecords } from "@usegraft/core";
import { z } from "zod";

export const recentOrders = defineFunction({
  name: "recentOrders",
  kind: "query",
  input: z.object({ limit: z.number().optional() }),
  handler: async ({ input, ctx }) => listRecords(ctx.db, "orders", { limit: input.limit }),
});
```

Functions are served at `POST /api/fn/<name>` by `graft serve`, and exposed to agents over MCP as `run_function`. Mark one `destructive` and it is gated behind a human approval.

## Also exported

`createFunctionsHandler`, `insertRecord`, `deleteRecord`, `searchRecords`, `mergePrimitives`, `defineDataMigration`, `canonicalJson`, `MAX_RECORD_LIMIT`.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/core/CHANGELOG.md)
