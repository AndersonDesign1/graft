# @usegraft/content-migrations

> Codemod-style transforms for authored content when the schema changes.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Why

Content lives in files that git owns. When you add a required field or rename one, a hosted CMS would migrate rows behind your back. Here the files are the truth, so the migration rewrites the files and you review the diff.

## Install

```bash
npm i @usegraft/content-migrations@beta
```

## Write one

Migrations live in `migrations/<seq>-<name>.ts`.

```ts
// migrations/0001-pages-description.ts
import { defineContentMigration } from "@usegraft/content-migrations";

export default defineContentMigration({
  collection: "pages",
  migrate: (doc) => ({
    ...doc,
    data: { ...doc.data, description: doc.data.description ?? doc.data.title },
  }),
});
```

## Run it

```bash
graft migrate            # preview the diff
graft migrate --apply    # write the files
```

Applied migrations are recorded in `migrations_applied`, with the git SHA of the checkout at apply time.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/content-migrations/CHANGELOG.md)
