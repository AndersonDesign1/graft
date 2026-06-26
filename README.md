# Graft

> The agent-native CMS. Everything is code; the agent is the operator, the human is optional.

Graft is a CMS built so an **AI agent** is the primary operator. Content, schema, logic, and access
are **owned code** an agent edits directly, backed by a self-hostable Postgres engine, with
**git-native versioning**, **copy-on-write database branches**, and **shadcn-style owned
extensibility**. Humans get an optional Studio and a configurable approval policy.

See the full PRD and phased delivery plan in
[`docs/PRD.md`](docs/PRD.md) _(linked from the planning doc)_.

## Status

**Phase 0 — Foundations.** Monorepo scaffolding, package skeletons, tooling. Nothing functional yet.

## Requirements

- Node `>=20` (developed on 24)
- [pnpm](https://pnpm.io) `10.x`
- Docker (for Postgres + MinIO in later phases)

## Getting started

```bash
pnpm install
pnpm build
pnpm test

# bring up local infra (Postgres + MinIO) — needed from Phase 1 onward
docker compose up -d
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
