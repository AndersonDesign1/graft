---
"@usegraft/cli": patch
---

`graft create --framework nuxt` makes a Nuxt site with `@usegraft/sdk-nuxt`
set up: a home page, a page for each collection and each entry, server-rendered
through the module's composables, and MDX bodies compiled by a server route and
rendered with `<GraftMdx>`. It works with every template, on the static index
or Postgres.
