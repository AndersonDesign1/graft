---
"@usegraft/cli": minor
---

`graft dev -- <command>` runs your site's dev server alongside it. The server
starts after the first compile that succeeds, so the index exists when it
does, and `graft dev` keeps recompiling whenever a content file or
`graft.config.ts` changes. Ctrl+C stops both, and when the server exits, so
does `graft dev`, with its exit code.

```json
"scripts": { "dev": "graft dev -- next dev" }
```

Sites from `graft create --framework next`, `nuxt` and `sveltekit` now use it
in their `dev` script. On a site whose content is in files, saving a content
file now shows on the next page load; before, it needed `npx graft compile`
after each edit. A site whose content is in the database shows what Studio
publishes, as before.
