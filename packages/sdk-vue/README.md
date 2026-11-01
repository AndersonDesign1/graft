# @usegraft/sdk-vue

> Vue client: typed reads over the content API, composables that run them, and MDX rendering with your own Vue components.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/sdk-vue
```

`vue` is a peer dependency, 3.5 or newer.

## Read content

```ts
// src/graft.ts
import { createGraft, createGraftComposables } from "@usegraft/sdk-vue";
import { collections } from "../graft.config";

export const graft = createGraft({ endpoint: "/api/content/v1", collections });
export const { useContent, useContentList, useContentSearch } = createGraftComposables(graft);
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { useContent, useContentSearch } from "./graft";

const route = useRoute();
const { data: post, loading, error } = useContent("posts", () => String(route.params.slug));

const query = ref("");
const { data: hits } = useContentSearch("docs", query);
</script>
```

Each composable returns `data`, `error` and `loading` as refs, plus `refresh`. Arguments can be plain values, refs or getters, so a read follows the route or a search box. The previous answer clears when the arguments change, and a late answer for old arguments is dropped. A blank search sends no request.

Types come from your own `graft.config.ts` at compile time, so `post.data.title` is checked and an unknown collection name is a compile error. The wire carries documents, never type information.

The composables are a binding, not a cache. During server rendering they report loading. In Nuxt, call `graft.getContent` inside `useAsyncData` to put content in the first HTML.

`provideGraft(other)` in a component's `setup`, or `app.use(graftPlugin(other))`, points the composables at another handle, such as a preview deployment's endpoint or a fake in tests.

## Render MDX

Compile on the server, render on the page. The compiler lives in its own entry, so it never reaches a browser bundle:

```ts
// in a server route
import { prepareMdx } from "@usegraft/sdk-vue/server";

const code = await prepareMdx(post.body);
```

```vue
<script setup lang="ts">
import { MdxContent } from "@usegraft/sdk-vue";
import Callout from "./Callout.vue";

defineProps<{ code: string }>();
</script>

<template>
  <MdxContent :code="code" :components="{ Callout }" />
</template>
```

`MdxContent` renders on the server and again when the page hydrates. A component gets the content between its tags as its default slot.

By default `prepareMdx` refuses executable MDX (`{expressions}`, `import`, `<script>`, event handlers) and drops `javascript:` and other script URLs, which Vue would otherwise render as they are. `MdxContent` runs the compiled string with `new Function`, so only pass it what your server produced. A page with a Content-Security-Policy needs `'unsafe-eval'` for it.

## What it cannot do

- **Reach the database.** There is no `db` option, so a connection string cannot end up in a browser bundle.
- **Choose a branch.** Each content API endpoint serves one branch. Passing `branch` with `endpoint` throws `CONFIG_INVALID`; point a second client at the preview's endpoint instead.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-vue/CHANGELOG.md)
