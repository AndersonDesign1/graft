# @usegraft/compiler

> Validate authored MDX against your collections and project it into the content index. The bridge that makes file-authored content queryable.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/compiler@beta
```

Most projects use `graft compile` from [`@usegraft/cli`](https://www.npmjs.com/package/@usegraft/cli) rather than calling this directly.

## Compile

```ts
import { compile, compileStatic } from "@usegraft/compiler";

// into Postgres
const result = await compile({ contentDir, collections, db, branchId: "main" });

// or into a SQLite artifact, with no database at all
const result = await compileStatic({ contentDir, collections, indexPath: ".graft/index.db" });
```

Both return a `ChangeSet`: what was added, changed and removed, plus the git SHA the tree was compiled from. Projection is a content-hash diff, not a delete-and-rebuild, so unchanged rows are untouched and removals are a soft delete.

## What it refuses, and why

`readDocs` validates every authored file before anything reaches the index:

- Frontmatter against the collection schema.
- Slug uniqueness within a collection.
- Files sitting outside a registered collection folder.
- **Executable MDX.** `{…}` expressions, `import`, `export` and spread attributes are refused, because rendering evaluates them as JavaScript on the server.

Every offending document is reported at once rather than the first found, because an author fixing them one at a time learns the rule slowly.

Set `export const mdxTrust = "full"` in `graft.config.ts` to allow full MDX. That is correct only where every author of the repository has commit access, since code review then really is the control. It defaults to `"restricted"`, matching `MdxBody`, so a document that compiles is a document that renders.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/compiler/CHANGELOG.md)
