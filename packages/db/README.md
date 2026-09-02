# @usegraft/db

> Postgres client, schema, copy-on-write branches, and the privilege split behind the approval gate.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/db
```

## Connect

```ts
import { createDb } from "@usegraft/db";

const handle = createDb(process.env.DATABASE_URL!);
try {
  // handle.db is a Drizzle client over the Graft schema
} finally {
  await handle.close();
}
```

## Two credentials, one job each

A deployed app or an autonomous agent should not hold a credential that can approve its own destructive operation. `hardenRuntimeRole` grants a role exactly what serving needs:

```ts
import { createDb, hardenRuntimeRole, runtimeRoleGrantsSql } from "@usegraft/db";

// Inspect the grants without applying them
console.log(runtimeRoleGrantsSql("graft_runtime"));

// Or apply them over an operator connection
await hardenRuntimeRole(handle.db, "graft_runtime");
```

The hardened role serves reads, runs functions, projects authored content, and files approval requests. It has **no `UPDATE` on `approvals`** and only a **column-scoped `INSERT`**, so it can neither flip a pending row nor file one that is already approved. Consuming an approval rides a `SECURITY DEFINER` function. Migration `0009` puts the same rule in the table, so it holds for every role including the owner.

Create the role yourself first, then harden it:

```sql
CREATE ROLE graft_runtime LOGIN PASSWORD '…';
```

## Branches

`resolveBranchScope` plus overlay-aware `readContent` / `searchContent` implement copy-on-write content branches. A branch searches its full ancestor chain, so inherited content is found, branch overrides win, and tombstones hide.

## Migrations

Schema lives in `drizzle/`, applied by `node packages/db/scripts/migrate.mjs` or `graft db migrate`. Migrations are shipped in the package and applied in journal order.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/db/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/main/SECURITY.md)
