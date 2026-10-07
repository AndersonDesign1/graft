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

// in your own route handler, called with a compile's change list
revalidateContent(branch, changes);

// in a Server Action, for read-your-own-writes (Next.js 16 only)
updateContent(branch, changes);
```

Both turn a compile's `ChangeSet` into the exact `revalidateTag` / `updateTag` calls that refresh the changed pages, and no others. A no-op unless your reads were tagged, but always safe to call. On Next.js 16, tag reads with `'use cache'` and `cacheTag`. On Next.js 15, wrap them in `unstable_cache` with `tags: tagsFor(...)`. `updateContent` needs Next.js 16 and throws on older versions. Use `revalidateContent` there.

## Supported versions

Next.js 15.5.24 and later 15.x, and 16.3.3 and later, with the App Router and React 19. Those are the first releases with the fixes for the critical Next.js advisories published in 2026. CI builds and serves a real app on each major. Next.js 14 is not supported: it no longer gets security fixes, and it has open critical advisories.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-next/CHANGELOG.md)
