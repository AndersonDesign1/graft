---
"@usegraft/sdk-nuxt": patch
"@usegraft/sdk-nitro": patch
"@usegraft/mcp": patch
---

Add `@usegraft/sdk-nuxt`, the Nuxt module, for Nuxt 4.6 and newer and Nuxt 5.
One line in `nuxt.config.ts` wires what the Nuxt guide used to have you write
by hand:

```ts
export default defineNuxtConfig({
  modules: ["@usegraft/sdk-nuxt"],
  graft: { contentApi: true },
});
```

Pages get `useGraftContent`, `useGraftList` and `useGraftSearch`, typed from
your collections. They read on the server for the first paint, the result
rides the payload into hydration, and a client-side navigation reads the next
document over HTTP. Server routes get `useGraft()`, the typed read handle over
the engine `graft.config.ts` names: the static index, or Postgres at
`NUXT_GRAFT_DATABASE_URL` (falling back to `DATABASE_URL`). `<GraftMdx>` and
`prepareMdx` render MDX bodies with your Vue components. The `contentApi`,
`functions` and `mcp` options mount `/api/content/v1`, `/api/fn/:name` and
`/api/mcp`. A route that needs Postgres on the static engine answers `503` with
`CONFIG_INVALID` and a fix.

The server code imports from `nuxt/server`, which Nuxt added in 4.6.0, so one
build runs on Nitro 2 (Nuxt 4) and Nitro 3 (Nuxt 5). CI builds a real Nuxt
4.6.3 app and a real Nuxt 5 nightly app, type-checks each against its own
Nuxt, serves it and drives it in Chromium.

`graftHandler` in `@usegraft/sdk-nitro` now accepts the portable event
`nuxt/server`'s `defineEventHandler` passes, whose context holds unknown
values. Before, that was a type error, though it worked at runtime. A
`clientAddress` that is not a string is now ignored.

`list_packages` answers `framework: "nuxt"` with `@usegraft/sdk-nuxt`.
