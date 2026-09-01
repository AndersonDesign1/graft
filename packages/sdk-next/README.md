# @usegraft/sdk-next

> Next.js App Router adapter: typed content reads in Server Components, cache-tag invalidation, and real MDX rendering.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-next
```

## Read content

`createGraft` wraps the read client with `React.cache`, so repeated reads of the same document within one render are deduped. Server-only: it holds a database handle.

```ts
// lib/graft.ts
import { createDb } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-next";
import { collections } from "@/graft.config";

export const graft = createGraft({ db: createDb(process.env.DATABASE_URL!).db, collections });
```

```ts
// in a Server Component
const page = await graft.getContent("pages", "home");
const posts = await graft.listContent("posts", { limit: 10 });
```

Return types come from your `defineCollection` schemas, so a renamed field is a build error rather than a runtime `undefined`.

### With no database

Pass `index` instead of `db` and the same surface reads the SQLite artifact `graft compile` writes. Nothing else has to be running.

```ts
import { openStaticIndex } from "@usegraft/db";

export const graft = createGraft({
  index: await openStaticIndex(".graft/index.db"),
  collections,
});
```

## Render MDX bodies

```tsx
import { MdxBody } from "@usegraft/sdk-next";
import { mdxComponents } from "@/components/mdx-components";

<MdxBody source={page.body} components={mdxComponents} />;
```

`MdxBody` defaults to `trust: "restricted"`, which refuses `{…}` expressions, `import`, `export` and spread attributes. Rendering evaluates MDX as JavaScript on the server, so on a Studio hosted for writers, "can author a page" would otherwise mean "can execute code on the render host".

Pass `trust="full"` only when every author of the repository has commit access, and set `export const mdxTrust = "full"` in `graft.config.ts` to match. The two have to agree.

## Invalidate only what changed

```ts
import { revalidateContent, updateContent } from "@usegraft/sdk-next";

// in a route handler, after a compile webhook
revalidateContent(branch, changes);

// in a Server Action, for read-your-own-writes
updateContent(branch, changes);
```

Both turn a compile's `ChangeSet` into the exact `revalidateTag` / `updateTag` calls that refresh the changed pages, and no others. A no-op unless your reads were cached with `'use cache'` and `cacheTag`, but always safe to call.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-next/CHANGELOG.md)
