---
"@usegraft/cli": minor
---

`graft dev -- <command>` runs your site's dev server alongside it. It compiles
first, so the index exists when the server starts, then recompiles whenever a
content file or `graft.config.ts` changes. Ctrl+C stops both, and when the
server exits, so does `graft dev`, with its exit code.

```json
"scripts": { "dev": "graft dev -- next dev" }
```

Sites from `graft create --framework next`, `nuxt` and `sveltekit` now use it
in their `dev` script, so saving a content file shows on the next page load.
Before, they compiled once at start and needed `npx graft compile` after each
edit.
