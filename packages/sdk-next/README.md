# @usegraft/sdk-next

> Next.js adapter for the App Router and the Pages Router: typed content reads, cache-tag invalidation, and real MDX rendering.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-next
```

## Read content

`createGraft` wraps the read client with `React.cache` where React has it, so repeated reads of the same document within one render are deduped. Server-only: it holds a database handle. Use it in Server Components, route handlers, `getStaticProps` and `getServerSideProps`.

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

Both turn a compile's `ChangeSet` into the exact `revalidateTag` / `updateTag` calls that refresh the changed pages, and no others. A no-op unless your reads were tagged, but always safe to call. On Next.js 16, tag reads with `'use cache'` and `cacheTag`. On Next.js 14 and 15, wrap them in `unstable_cache` with `tags: tagsFor(...)`. The Pages Router refreshes by path instead, with `res.revalidate`. `updateContent` needs Next.js 16 and throws on older versions. Use `revalidateContent` there.

## Use the Pages Router

Read in `getStaticProps`, compile the body there with `prepareMdx`, and render it with `MdxContent` from `@usegraft/sdk-next/mdx`, which carries no server code:

```tsx
import { prepareMdx } from "@usegraft/sdk-next";
import { MdxContent } from "@usegraft/sdk-next/mdx";

// in getStaticProps
const code = await prepareMdx(page.body);

// in the page
<MdxContent code={code} />;
```

## Supported versions

Next.js 14.2 and later 14.x, 15 and 16, with the App Router or the Pages Router, on React 18.2 or 19. CI builds and serves a real app on each major, with an App Router and a Pages Router page.

Next.js 14 no longer gets security fixes. 14.2.35, its last release, is affected by 23 published Next.js advisories, two of them critical remote code execution, and none will be fixed on 14. Graft runs on it so you can adopt Graft before you upgrade, not as a place to stay. 15.5.24 and 16.3.3 are the first releases with fixes for the critical Next.js advisories published in 2026. `withGraft` warns when your app runs a release without them.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-next/CHANGELOG.md)
