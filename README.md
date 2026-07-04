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

**Phase 2 — The Wow Loop (in progress).** The core pipeline works end-to-end:

- Authored MDX is validated against a Zod schema defined in code (`defineCollection`) and
  projected atomically into a Postgres `content_index` (hash-diff; every run leaves a
  `compilations` audit row with the git SHA).
- Typed reads via `@graft/sdk-core` / `@graft/sdk-next`;
  [`examples/landing-page`](examples/landing-page) renders authored content in Next.js.
- Agents operate content over MCP: `@graft/mcp` exposes `list_collections`, `describe_schema`,
  `list_content`, `get_content`, `write_content` (validate → write MDX → compile in one call),
  and `explain_error`. Registered for this repo in [`.mcp.json`](.mcp.json); agent guide at
  [`examples/landing-page/llms.txt`](examples/landing-page/llms.txt).
- The `graft` CLI is real: `graft init` scaffolds a project (schema + content + llms.txt),
  `graft compile` projects the content tree once, `graft dev` watches content and
  `graft.config.ts` (hot-reloaded) and recompiles on every save.

Still to come in Phase 2: MCP over HTTP (for remote/eve agents), asset fields (R2-backed
images), and the cold-agent end-to-end test.

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

## Monorepo layout

| Package                     | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `@graft/core`               | Schema (`defineCollection`), function runtime, access, migrations |
| `@graft/compiler`           | Authored content → Postgres index + typegen + validation          |
| `@graft/content-migrations` | Codemod-style authored-content transforms                         |
| `@graft/db`                 | Postgres + Drizzle + branching abstraction                        |
| `@graft/assets`             | S3/MinIO storage, transforms, agent upload primitives             |
| `@graft/auth`               | Scoped tokens, policy-as-code, audit log                          |
| `@graft/contracts`          | Shared types, error codes, introspection schemas                  |
| `@graft/mcp`                | MCP server (primitives + introspection)                           |
| `@graft/cli`                | Human + agent CLI (`graft`)                                       |
| `@graft/studio`             | Optional human Studio UI                                          |
| `@graft/registry`           | shadcn-style owned-primitive registry                             |
| `@graft/sdk-core`           | Framework-agnostic client + cache contract                        |
| `@graft/sdk-next`           | Next.js adapter                                                   |

## Conventions

See [`CONVENTIONS.md`](CONVENTIONS.md).
