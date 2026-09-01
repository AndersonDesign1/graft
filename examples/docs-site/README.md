# Graft docs site

This Astro app dogfoods Graft. It proves that MDX content can be compiled into
the Postgres index, read and searched through the typed Astro SDK, rendered in a
Fumadocs shell, and exposed to agents through the same typed functions and MCP
handlers described by the docs.

Postgres is required for this example because `graft.config.ts` defines typed
functions and the app reads the Postgres content index at request time. Use a
database dedicated to this project.

## Setup

Install from the repository root, then set `DATABASE_URL` in the root `.env` or
`examples/docs-site/.env`. The app-local file takes precedence.

```sh
pnpm install
pnpm --filter docs-site exec graft db migrate
pnpm --filter docs-site compile
pnpm --filter docs-site dev
```

Set `GRAFT_DEV_TOKEN` when testing authenticated function or MCP calls.
`GRAFT_MCP_ALLOW_ANONYMOUS=1` permits anonymous MCP access for local development
only.

Build with:

```sh
pnpm --filter docs-site compile
pnpm --filter docs-site build
```

## Routes

- `/`, `/why`, and `/security` render Graft-authored site pages.
- `/docs` redirects to the first page in the docs reading path.
- `/docs/<slug>` renders a documentation page.
- `/api/search` searches the docs index.
- `/api/fn/<name>` invokes a typed Graft function.
- `/api/mcp` serves stateless Streamable HTTP MCP.

A headless `graft serve` also mounts `/api/content/v1/documents` and
`/api/content/v1/search` for remote SDK reads. This example talks to Postgres
directly, so it does not use those routes.
