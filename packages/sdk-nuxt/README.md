# @usegraft/sdk-nuxt

The Graft module for Nuxt 4.6 and newer, and Nuxt 5. Server-rendered content in
pages, typed reads in server routes, MDX, and the content API, functions and
MCP routes, from one line in `nuxt.config.ts`.

```sh
npm i @usegraft/sdk-nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@usegraft/sdk-nuxt"],
  graft: { contentApi: true },
});
```

## In pages

`useGraftContent`, `useGraftList` and `useGraftSearch` are auto-imported. They
read on the server for the first paint and over HTTP after it, and return
Nuxt's `AsyncData`, typed from your `graft.config.ts`:

```vue
<script setup lang="ts">
const route = useRoute();
const { data: page } = await useGraftContent("pages", () => String(route.params.slug));
</script>

<template>
  <h1>{{ page?.data.title }}</h1>
</template>
```

They read through the content API, so turn on `contentApi`.

## In server routes

`useGraft()` is auto-imported into `server/`. It reads the engine
`graft.config.ts` names: the static index (`index = "static"`), or Postgres at
`NUXT_GRAFT_DATABASE_URL`, falling back to `DATABASE_URL`.

```ts
// server/api/title/[slug].get.ts
import { defineEventHandler, getRouterParam } from "nuxt/server";

export default defineEventHandler(async (event) => {
  const graft = await useGraft();
  const page = await graft.getContent("pages", getRouterParam(event, "slug") ?? "");
  return { title: page?.data.title ?? null };
});
```

`prepareMdx` (in `server/`) and `<GraftMdx>` (in pages) render a document's MDX
body with your own Vue components.

## Options

| Option       | Default             | What it does                                                                       |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| `config`     | `"graft.config.ts"` | Your Graft config, relative to the Nuxt root                                       |
| `contentApi` | `false`             | Mounts `GET /api/content/v1/*`, which the page composables read                    |
| `functions`  | `false`             | Mounts `POST /api/fn/:name`. Needs Postgres, `@usegraft/core` and `@usegraft/auth` |
| `mcp`        | `false`             | Mounts `POST /api/mcp`. Needs Postgres, `@usegraft/auth` and `@usegraft/mcp`       |

Runtime settings take `NUXT_GRAFT_DATABASE_URL`, `NUXT_GRAFT_STATIC_INDEX`,
`NUXT_GRAFT_DEV_TOKEN` (development only) and `NUXT_GRAFT_TRUSTED_ISSUERS`.

The full guide is at [graft.page/docs/nuxt](https://graft.page/docs/nuxt).

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/sdk-nuxt/CHANGELOG.md)
