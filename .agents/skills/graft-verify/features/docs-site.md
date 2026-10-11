# Docs site

A developer reads a guide, copies code, switches tabs, and gets the same page
as Markdown.

## Sub-features

- `docs.page`: `/docs/<slug>` renders with sidebar, contents rail and page
  actions.
- `docs.markdown`: `/docs/<slug>.md` and `Accept: text/markdown` return the
  Markdown twin.
- `docs.llms`: `/llms.txt` and `/llms-full.txt` list every page.
- `docs.search`: the search dialog answers as you type.
- `docs.landing`: `/` renders the landing page.

## How to get to it (user POV)

- A browser at the site root or a docs link.
- An agent fetching `https://graft.page/docs/<slug>.md`.

## Driving it with agent-browser

Preconditions: built packages (`pnpm -r --filter 'docs-site^...' run build`),
then in `examples/docs-site` run `npx astro dev --port 4321 --host 127.0.0.1 &`
and record `ASTRO_PID=$!`. Ready when
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4321/docs/getting-started`
prints `200`.

- **The page renders.**
  `agent-browser --color-scheme dark open http://127.0.0.1:4321/docs/getting-started`,
  `agent-browser set viewport 1440 900`, `agent-browser screenshot desktop-dark.png`.
  Repeat with `--color-scheme light` and at `390 844`.
- **No sideways scroll on phones.**
  `agent-browser eval "document.documentElement.scrollWidth === document.documentElement.clientWidth"`
  prints `true` at 390px.
- **The Markdown twin matches.**
  `curl -s http://127.0.0.1:4321/docs/getting-started.md | head -3` prints
  `# Getting started` and the description as a `>` quote.
- **Accept negotiation is routed.** It exists only in the production build
  output, not in `astro dev`. After `pnpm --filter docs-site build`, check
  that `.vercel/output/config.json` has a route with
  `"value": ".*text/markdown.*"` and `"dest": "/docs/$1.md"`.
- **The site checks pass.** From the repo root: `pnpm check:site`,
  `pnpm check:error-docs`, and `pnpm --filter docs-site test`.

## Gotchas

- `pkill -f "astro dev"` inside a shell whose own command line contains that
  text kills the shell. Kill `$ASTRO_PID` instead.
- `astro dev --background` may report "already running" from an earlier
  session. Check with `astro dev status`.
- The site compiles `examples/docs-site/content` into `.graft/index.db`, which
  is tracked. Do not commit an index change you did not mean to make.
- A running `astro dev` keeps the index it opened at start. After
  `graft compile`, restart the dev server or new MDX components and edits do
  not show.
- A recompile with no content change still rewrites `index.db` (the compile
  stamp). `git checkout` it back rather than committing noise.
