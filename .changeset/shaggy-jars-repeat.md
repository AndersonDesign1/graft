---
"@usegraft/sdk-astro": patch
"@usegraft/sdk-core": patch
"@usegraft/sdk-next": patch
"@usegraft/cli": patch
---

Fix the install command on every package page. `npx graft` resolves to an
unrelated package on npm, so the documented way to run the CLI without
installing fetched the wrong thing. It is `npx @usegraft/cli` everywhere now,
with a note saying why the scoped name is needed.

Fix the `graftRoute` example in `@usegraft/sdk-astro`. It showed a config
object, but `graftRoute` takes the handler, so the snippet did not compile.

Document the static index in the SDK READMEs. `createClient` and `createGraft`
both accept `index` from `openStaticIndex(".graft/index.db")`, which is what
`graft init` scaffolds by default, and none of the READMEs mentioned it. Every
read example now shows where its `db` or `index` comes from instead of leaving
the handle undefined.

`@usegraft/sdk-sveltekit` gets the same treatment in the repository, but it
is still `private` and so cannot be named in a changeset. Its README ships with
whatever release first publishes it.
