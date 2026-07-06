# Graft

> The agent-native CMS. Everything is code; the agent is the operator, the human is optional.

Graft is a CMS built so an **AI agent** is the primary operator. Content, schema, logic, and access
are **owned code** an agent edits directly, backed by a self-hostable Postgres engine, with
**git-native versioning**, **copy-on-write database branches**, and **shadcn-style owned
extensibility**. Humans get an optional Studio and a configurable approval policy.

Design decisions from the de-risking spikes live in
[`docs/design-notes/`](docs/design-notes/). (The PRD and phase tracker are private planning docs,
kept out of the repo.)

## Status

**Phase 3 — Runtime data, security & search: complete.** "Everything is code" now
extends to live, mutating data — safely. On top of the Phase 2 wow loop (a fresh agent
authoring a page with an R2-hosted image, unaided), Graft now runs typed functions,
verifies agent identity, audits every call, and searches every layer:

- **Authored content** is validated against a Zod schema defined in code
  (`defineCollection`) and projected atomically into a Postgres `content_index` (hash-diff;
  every run leaves a `compilations` audit row with the git SHA). Typed reads via
  `@graft/sdk-core` / `@graft/sdk-next`; [`examples/landing-page`](examples/landing-page)
  renders it in Next.js, hero image resolved from R2.
- **Typed function runtime.** `defineFunction` + `createFunctionsHandler` — stateless
  Web-standard `Request → Response` RPC with a standard context
  (`input`/`db`/`actor`/`branch`/`correlationId`); success is `{ data }`, failures are
  `GraftError` JSON carrying a `fix`. Mutating data lives in a db-authoritative
  `data_records` table, validated against its collection schema on write _and_ read.
- **Auth — verify identity, never mint it.** `@graft/auth`'s `createActorResolver` verifies
  bearer OIDC JWTs (via jose; JWKS inline/URL/discovery, `iss`/`exp`/`aud`, scope claims)
  plus static dev tokens; a bad token is `TOKEN_INVALID` (401), never a silent downgrade.
  Mutations reject anonymous callers unless explicitly `public: true`. The example hosts
  Better Auth as a reference issuer.
- **Audit, rate limits & the human gate.** Every invocation writes an `audit_log` row
  (actor, correlation id, git SHA, status, duration); rate limits ride that log (stateless
  DB counts → 429). Destructive ops are always human-gated: the call files a pending
  approval and 403s with its id; a human runs `graft approve <id>`; the caller retries with
  `x-graft-approval`. Approvals are one-shot and bound to the exact function + input.
- **Search is a property of the index.** Generated, weighted `tsvector` columns + GIN on
  `content_index` and `data_records` mean every write path is searchable with zero app-side
  bookkeeping. Surfaced as `searchDocuments` (sdk-core), `searchContent` (sdk-next), the
  `search_content` MCP tool, and gated `searchRecords` functions for data.
- **Migrations are code.** `migrations/<seq>-<name>.ts` default-exports
  `defineContentMigration` (codemod-style, all-or-nothing frontmatter rewrites) or
  `defineDataMigration` (transactional `data_records` backfills), tracked in a
  `migrations_applied` ledger. `graft migrate` is dry-run by default; `--apply` is the
  operator's consent.
- **Agent surfaces.** Content ops over MCP (`list_collections`, `describe_schema`,
  `list_content`, `get_content`, `write_content`, `search_content`, `explain_error`) via
  stdio and Streamable HTTP (`createGraftMcpHandler`, mounted at `POST /api/mcp` and now on
  the actor resolver). Registered for this repo in [`.mcp.json`](.mcp.json); agent guide at
  [`examples/landing-page/llms.txt`](examples/landing-page/llms.txt).

Next: Phase 4 — branching & versioning UX: `graft branch` (copy-on-write DB branches),
`graft merge` replaying the migrations ledger, and the sdk-core cache-invalidation contract.

## Requirements

- Node `>=20` (developed on 24)
- [pnpm](https://pnpm.io) `11.x` (pinned via `packageManager`)
- Docker (for the self-host Postgres + MinIO stack)

## Getting started

```bash
pnpm install
pnpm build
pnpm test        # unit tests; live integration tests are opt-in via RUN_INTEGRATION=1

# self-host infra (Postgres 18 + MinIO); dev currently runs against Neon + R2 via .env
docker compose up -d
```

To see the loop: set `DATABASE_URL` in a repo-root `.env`, then

```bash
pnpm --filter landing-page compile   # graft compile: project content/ into Postgres
pnpm --filter landing-page watch     # graft dev: recompile on every save (optional)
pnpm --filter landing-page dev       # renders at http://localhost:3000
```

### Try the runtime

With the example app running (`pnpm --filter landing-page dev`), the typed functions from
`examples/landing-page/graft.config.ts` are live at `POST /api/fn/<name>` — success returns
`{ data }`, failure returns a `GraftError` JSON carrying a `fix`:

```bash
# Open query — lists the live page slugs straight from content_index:
curl -s localhost:3000/api/fn/pageStats -d '{}'

# Public mutation — the contact form's endpoint (anonymous allowed, 5/min per IP):
curl -s localhost:3000/api/fn/submitContact \
  -d '{"email":"a@b.com","message":"hi"}'

# Scope-gated query — needs a token; mutations reject anonymous callers by default.
# Set GRAFT_DEV_TOKEN in .env, then present it as a bearer:
curl -s localhost:3000/api/fn/listSubmissions \
  -H "authorization: Bearer $GRAFT_DEV_TOKEN" -d '{}'
```

Destructive functions (e.g. `deleteSubmission`) are human-gated: the call 403s with a
pending approval id, a human runs `graft approve <id>`, and the caller retries with an
`x-graft-approval: <id>` header. See [`llms.txt`](examples/landing-page/llms.txt) for the
full surface, including the `search_content` MCP tool and Better Auth token minting.

## Monorepo layout

| Package                     | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `@graft/core`               | Schema (`defineCollection`), function runtime, access, migrations |
| `@graft/compiler`           | Authored content → Postgres index + typegen + validation          |
| `@graft/content-migrations` | Codemod-style authored-content transforms                         |
| `@graft/db`                 | Postgres + Drizzle + branching abstraction                        |
| `@graft/assets`             | S3/MinIO storage, transforms, agent upload primitives             |
| `@graft/auth`               | OIDC token verification, actor resolver, scope-based access       |
| `@graft/contracts`          | Shared types, error codes, introspection schemas                  |
| `@graft/mcp`                | MCP server (primitives + introspection)                           |
| `@graft/cli`                | Human + agent CLI (`graft`)                                       |
| `@graft/studio`             | Optional human Studio UI                                          |
| `@graft/registry`           | shadcn-style owned-primitive registry                             |
| `@graft/sdk-core`           | Framework-agnostic client + cache contract                        |
| `@graft/sdk-next`           | Next.js adapter                                                   |

## Conventions

See [`CONVENTIONS.md`](CONVENTIONS.md).
