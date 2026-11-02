---
"@usegraft/cli": minor
"@usegraft/sdk-sveltekit": patch
---

`graft create --framework sveltekit` makes a SvelteKit 3 site with
`@usegraft/sdk-sveltekit` set up: a home page, a page for each collection and
each entry, read in server `load` functions, and MDX bodies prepared on the
server and rendered with `<MdxContent>`. It works with every template, on the
static index or Postgres. The site imports through `#lib`, because SvelteKit 3
removed `$lib`, and a Postgres site declares `DATABASE_URL` in `src/env.ts`,
because SvelteKit 3 replaced `$env/static/private`. The SvelteKit guide and the
README now say both.

The AGENTS.md every generated site gets no longer says the dev server recompiles
content. It compiles once at start: a static site needs `npx graft compile`
after a content edit, and a Postgres site shows a Studio publish on the next
page load.
