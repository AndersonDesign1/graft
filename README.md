# Graft

> The agent-native CMS. Everything is code; the agent is the operator, the human is optional.

Graft is a CMS built so an **AI agent** is the primary operator. Content, schema, logic, and access
are **owned code** an agent edits directly, backed by a self-hostable Postgres engine, with
**git-native versioning**, **copy-on-write database branches**, and **shadcn-style owned
extensibility**. Humans get an optional Studio and a configurable approval policy.

Design decisions from the de-risking spikes live in
[`docs/design-notes/`](docs/design-notes/). (The PRD and phase tracker are private planning docs,
kept out of the repo.)

## Quickstart — no database required

A content project needs **no services at all**. `graft compile` writes the content index to a
SQLite artifact, and your app reads it embedded:

```bash
npx graft init          # scaffolds schema, content/, llms.txt (static index by default)
npx graft compile       # → .graft/index.db — no DATABASE_URL, no containers
```

```ts
import { openStaticIndex } from "@usegraft/db";
import { createClient } from "@usegraft/sdk-core";
import { collections } from "./graft.config";

const index = await openStaticIndex(".graft/index.db");
const graft = createClient({ index, collections });
const home = await graft.getDocument("pages", "home"); // fully typed, zero codegen
```

The artifact is derived from the files in git, so it is git-ignored and rebuilt in your build
command (`graft compile && next build`). Preview branches are just git branches — each checkout
compiles its own index. Full-text search works too; it is a property of the artifact.

Agents get the same surface here — `graft mcp` serves a static project, so an agent can author,
read, and search content with no database attached.

**When you need more:**

```bash
# 1. set DATABASE_URL in .env, 2. flip one line: export const index = "postgres"
npx graft db migrate    # applies the schema that ships with @usegraft/db
npx graft compile
```

Postgres unlocks operational data (form submissions, orders, comments), typed functions with
auth/audit/approvals, and copy-on-write database branches — and Graft tells you the moment you
need it: reaching for one of those in static mode fails with `NEEDS_DATABASE`, whose `fix` is the
upgrade above. Design note:
[`docs/design-notes/static-index.md`](docs/design-notes/static-index.md).

## Status

**Phase 5 — Registry + commerce vertical: complete.** On top of Phases 2–4 (wow loop, runtime
data, auth, branching, cache tags), Graft now ships **owned primitives** and a real content body
model:

- **Real MDX bodies.** Authored `*.mdx` is compiled and rendered via `@usegraft/sdk-next`
  `MdxBody` with a generated `components/mdx-components.ts` map — registry **blocks** are real
  React components, not markdown-only fakes.
- **`graft add`.** Local-first registry (`@usegraft/registry`): Tier-1 `seo` / `callout` / `faq` /
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

**Phase 7 — Packaging, SDKs & launch (in progress).** **P7.1** ships the headless runtime:
`graft serve` binds the same stateless handlers the example app mounts (typed functions, MCP
over Streamable HTTP, `/healthz` with a real DB round-trip) to a plain Node server — what a
self-host container runs. Identity is env-driven (`GRAFT_DEV_TOKEN`, `GRAFT_TRUSTED_ISSUERS`
for OIDC via discovery, `GRAFT_MCP_REQUIRE_AUTH`, `GRAFT_APPROVAL_POLICY`), and
`graft harden <role>` applies the runtime privilege split so the deployed credential can
request and consume approvals but never decide them. Topology decisions in
[`docs/design-notes/packaging.md`](docs/design-notes/packaging.md). **P7.2** ships the
container ([`deploy/docker/`](deploy/docker/README.md)): one image = Postgres 18 + MinIO +
`graft serve` — `docker run -p 3903:3903 graft` boots migrate → compile → serve and logs a
generated bearer (anonymous MCP is never exposed); mount your project at `/project`, set
`GRAFT_RUNTIME_PASSWORD` to serve under a hardened role, or use the split
`deploy/docker/compose.yml` (db / storage / graft — swap to Neon/R2 by env alone). **P7.3**
adds the deploy adapters ([`deploy/`](deploy/README.md)): Railway, Fly, and VPS run the
container; Vercel deploys embedded (compile as a build step; the example app is the
reference) — every adapter carries the runtime-credential harden recipe. **P7.4** ships
`@usegraft/sdk-astro` and `@usegraft/sdk-sveltekit`: the same typed `getContent`/`listContent`/
`searchContent` surface as sdk-next plus `graftRoute` — mounting the function/MCP handlers is
one property access because both frameworks' endpoints are already Web-standard; cache
invalidation maps the tag contract onto CDN surrogate keys. Next: docs site + compare page.

## Telemetry

**None.** Graft collects no analytics, sends no usage pings, and phones home from no command.
The only network calls it makes are the ones your project configures: your database, your asset
store, and (if you use them) Neon's branching API and your OIDC issuer.

## Requirements

- Node `>=22.16` (developed on 24). The static index's FTS5 search needs the
  `node:sqlite` build that ships from 22.16.0 — also comfortably above pnpm 11's
  own floor. Node 20 reached end-of-life in April 2026.
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
(`runtimeRoleGrantsSql` / `hardenRuntimeRole` in `@usegraft/db` emit the grants; see
[`docs/design-notes/approval-hardening.md`](docs/design-notes/approval-hardening.md)).

## Monorepo layout

| Package                        | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `@usegraft/core`               | Schema (`defineCollection`), function runtime, access, migrations   |
| `@usegraft/compiler`           | Authored content → Postgres index + typegen + validation            |
| `@usegraft/content-migrations` | Codemod-style authored-content transforms                           |
| `@usegraft/db`                 | Postgres + Drizzle + branching abstraction                          |
| `@usegraft/assets`             | S3/MinIO storage, transforms, agent upload primitives               |
| `@usegraft/auth`               | OIDC token verification, actor resolver, scope-based access         |
| `@usegraft/contracts`          | Shared types, error codes, introspection schemas                    |
| `@usegraft/mcp`                | Project MCP (content + functions + introspection)                   |
| `@usegraft/cli`                | Human + agent CLI (`graft`, including `graft mcp` + `graft serve`)  |
| `@usegraft/studio`             | Opt-in Studio UI (`graft studio` / `serve --studio`; OpenAPI-first) |
| `@usegraft/registry`           | shadcn-style owned-primitive registry                               |
| `@usegraft/sdk-core`           | Framework-agnostic client + cache contract                          |
| `@usegraft/sdk-next`           | Next.js adapter + `MdxBody`                                         |
| `@usegraft/sdk-astro`          | Astro adapter (typed reads + endpoint mounts)                       |
| `@usegraft/sdk-sveltekit`      | SvelteKit adapter (typed reads + endpoint mounts)                   |

## Conventions

See [`CONVENTIONS.md`](CONVENTIONS.md).
