---
"@usegraft/cli": patch
---

Move the docs site to the static tier. It needs no database now.

The docs are MDX in git. The only things forcing Postgres were a `submissions`
collection and two functions — `docStats` and `submitContact` — that **no page
in `src/` referenced**. They were declared to exercise the Postgres tier and
never rendered, while the landing page carries that demo properly: its own
`submitContact`, wired to a `<ContactForm />` a visitor can actually post.

So documentation was paying a database's availability, cost and cold starts to
demonstrate something it did not show. `graft compile` writes `.graft/index.db`
and 36 pages prerender from it.

`/mcp` still serves agents — the docs MCP handler takes `staticIndexPath`, so it
reads the same artifact. `/api/search` stays on-demand for the same reason. The
two routes that genuinely needed Postgres, `/api/fn/[name]` and the
authenticated `/api/mcp`, are gone; both were already local-only, the latter by
its own comment ("never set it on a deployed instance").

The build is `graft compile && astro build`, and the Vercel adapter is told to
include the artifact — Vercel traces imports, not data files, so the on-demand
routes would otherwise deploy without the thing they read.
