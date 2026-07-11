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

**Phase 5 — Registry + commerce vertical: complete.** On top of Phases 2–4 (wow loop, runtime
data, auth, branching, cache tags), Graft now ships **owned primitives** and a real content body
model:

- **Real MDX bodies.** Authored `*.mdx` is compiled and rendered via `@graft/sdk-next`
  `MdxBody` with a generated `components/mdx-components.ts` map — registry **blocks** are real
  React components, not markdown-only fakes.
- **`graft add`.** Local-first registry (`@graft/registry`): Tier-1 `seo` / `callout` / `faq` /
  `scoped-access` / `comments`, Tier-2 **`commerce`** (file-authoritative products + db-authoritative
  orders + place/list/update/cancel). Pure file-drop + generated `graft/` barrel; zero config
  edits.
- **Typed nested fields.** `field.object` / `field.array` with recursive `describe_schema`.
- **Agent surfaces** (MCP + CLI + HTTP functions) live: compile, branch/merge, migrate,
  approvals, search, auth.

**Phase 6 — Self-teaching (in progress).** CI gates a cold-agent MCP path
(`pnpm test:cold-agent`). **P6.2** made the project MCP a full operator surface:
`list_functions` / `describe_function` / `run_function` (same access, audit, rate-limit, and
human-gate rules as `POST /api/fn/<name>`), plus `graft mcp` for one-command stdio install.
**P6.3** adds `list_registry` / `describe_item` so agents browse owned primitives before
`graft add`, and locks the whole introspection surface with contract tests. **P6.4** gates the
remote path in CI: a cold agent reaching Graft only over Streamable HTTP — auth wall first
(the 401 teaches the fix), then authoring, function invocation via the connection's bearer,
and registry browsing. **P6.5** completes the content-ops surface: `delete_content` (the
destructive human gate over MCP — approval filed on first call, `graft approve <id>`, one-shot
input-bound retry) and `put_asset` (upload via server-local `path` or remote `base64`;
refuses existing keys without `overwrite: true`) — and passed the **live off-repo cold-agent
exercise**: a fresh agent with no repo checkout and no llms.txt, taught only by tool
descriptions and error messages over network HTTP MCP, authored a page with an uploaded asset
and walked the human-gated delete end-to-end with **zero unintended failures**. Its friction
log fed straight back into the surface (asset-field teaching in `describe_schema`, MCP-speak
approval errors). See [`docs/design-notes/agent-mcp.md`](docs/design-notes/agent-mcp.md).
Next: TypeGen completeness + docs coverage close-out, then Phase 7 (packaging + launch).

## Requirements

- Node `>=20` (developed on 24)
- TypeScript **7** (native `tsc`; monorepo dual-install keeps TS 6 API for tsup DTS until tooling catches up)
- [pnpm](https://pnpm.io) `11.x` (pinned via `packageManager`)
- Docker (for the self-host Postgres + MinIO stack)

## Getting started

```bash
pnpm install
pnpm build
pnpm test        # unit tests; live integration tests are opt-in via RUN_INTEGRATION=1
pnpm test:cold-agent   # P6.1 self-teaching gate (also runs under pnpm test)

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
`examples/landing-page/graft.config.ts` (plus `graft/*` primitives) are live at
`POST /api/fn/<name>` — success returns `{ data }`, failure returns a `GraftError` JSON
carrying a `fix`:

```bash
# Open query — lists the live page slugs straight from content_index:
curl -s localhost:3000/api/fn/pageStats -d '{}'

# Public mutation — the contact form's endpoint (anonymous allowed, 5/min per IP):
curl -s localhost:3000/api/fn/submitContact \
  -d '{"email":"a@b.com","message":"hi"}'

# Commerce — place an order against content/products (public; prices snapshotted):
curl -s localhost:3000/api/fn/placeOrder \
  -d '{"email":"buyer@example.com","items":[{"productSlug":"team","qty":1}]}'

# Scope-gated query — needs a token; mutations reject anonymous callers by default.
# Set GRAFT_DEV_TOKEN in .env, then present it as a bearer:
curl -s localhost:3000/api/fn/listSubmissions \
  -H "authorization: Bearer $GRAFT_DEV_TOKEN" -d '{}'
```

Destructive functions (e.g. `deleteSubmission`, `cancelOrder`) are human-gated: the call 403s
with a pending approval id, a human runs `graft approve <id>`, and the caller retries carrying
that id — an `x-graft-approval: <id>` header over HTTP, or the `approval` tool argument over
MCP. See [`llms.txt`](examples/landing-page/llms.txt) for the full surface, including MCP
tools and Better Auth token minting.

The gate holds against the agent itself, not just accidents: approver == requester is refused
(`APPROVAL_SELF_DECISION`), decisions record the Postgres role they ran as (stamped
server-side), and consuming an approval rides a `SECURITY DEFINER` function — so a hardened
deployment can give its app/agent a runtime role with **no UPDATE on `approvals`**, making
`pending → approved` unreachable even with raw SQL against the app's own `DATABASE_URL`
(`runtimeRoleGrantsSql` / `hardenRuntimeRole` in `@graft/db` emit the grants; see
[`docs/design-notes/approval-hardening.md`](docs/design-notes/approval-hardening.md)).

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
| `@graft/mcp`                | Project MCP (content + functions + introspection)                 |
| `@graft/cli`                | Human + agent CLI (`graft`, including `graft mcp`)                |
| `@graft/studio`             | Optional human Studio UI                                          |
| `@graft/registry`           | shadcn-style owned-primitive registry                             |
| `@graft/sdk-core`           | Framework-agnostic client + cache contract                        |
| `@graft/sdk-next`           | Next.js adapter + `MdxBody`                                       |

## Conventions

See [`CONVENTIONS.md`](CONVENTIONS.md).
