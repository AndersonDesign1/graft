---
"@usegraft/cli": minor
"create-graft": minor
"@usegraft/mcp": patch
---

`graft create --framework astro`, `react-router` and `tanstack-start` make the
same site the other frameworks get: a home page, a page for each collection
and each entry, and MDX bodies rendered with the adapter's `MdxContent`. They
work with every template, on the static index or Postgres, and their `dev`
script runs the site under `graft dev`, so a saved content file shows on the
next page load.

- Astro 7 needs Node.js 22.23.4 or newer, and React Router 8 needs 22.22.
- The Astro site's `dev` script is `graft dev -- astro dev --ignore-lock`.
  Without `--ignore-lock`, Astro 7 moves its dev server to the background
  when an AI agent runs it, and `graft dev` stops with it.
- The TanStack Start site reads through server functions, and `npm start`
  serves the build on Node with srvx.

`--framework` also takes short names, in any case: `nextjs`, `svelte`, `rr`,
`tanstack` and the rest. An unknown name is refused with every name and short
name listed. The flag, its help, the question `graft create` asks and the CLI
reference all read one list of frameworks.
