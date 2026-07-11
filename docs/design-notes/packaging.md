# Packaging & deploy topology (Phase 7)

**Status: P7.0 decided · P7.1 (`graft serve` + `graft harden`) SHIPPED · P7.2
(container + compose) SHIPPED · P7.3 (deploy adapter docs) SHIPPED · P7.4
(Astro/SvelteKit SDKs) SHIPPED.** Remaining: docs site + compare page.

## What "self-host Graft" actually is

Graft ships **libraries and a CLI**, not a monolith. Everything the runtime
does is a stateless Web-standard handler (`Request → Response`) — the P3
invariant, locked before the first function existed precisely so packaging
would be a wrapper, not a rewrite. That leaves two deployment topologies, and
both must serve identical bytes:

1. **Embedded** — the user's app (Next today; Astro/SvelteKit SDKs later)
   mounts `createFunctionsHandler` + `createGraftMcpHandler` as routes
   (`examples/landing-page` is the reference). The app _is_ the runtime.
2. **Headless** — **`graft serve`** (P7.1): the same handlers bound to a plain
   `node:http` server by a thin adapter. No frontend framework in the
   process. This is what a container runs; any frontend talks to it over HTTP
   (or reads Postgres through sdk-core directly).

Identical bytes are guaranteed by construction: `graft serve` mounts the same
handler instances the app would, so there is nothing to keep in sync.

### `graft serve` surface (locked)

| Route                 | What                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/fn/<name>` | Typed function RPC — access, audit, rate limits, approvals, all P3 semantics         |
| `POST /api/mcp`       | MCP Streamable HTTP — content + function + registry tools                            |
| `GET /healthz`        | Liveness + a real `select 1` round-trip; reports branch/collections/functions/gitSha |
| anything else         | 404 `ROUTE_NOT_FOUND` GraftError whose fix lists the route map                       |

Env contract (same names the example app already taught):
`DATABASE_URL` (+ `--branch`, routed through `resolveBranchHandle`, so a
neon-backed branch serves its fork transparently); `GRAFT_DEV_TOKEN` /
`GRAFT_DEV_SCOPES` (static local identity); **`GRAFT_TRUSTED_ISSUERS`**
(comma-separated OIDC issuer URLs, verified via discovery — the
Connect/Passport-shaped enterprise path); `GRAFT_MCP_REQUIRE_AUTH=1`;
`GRAFT_APPROVAL_POLICY=human`; `PORT`/`HOST` (default loopback:3903 — binding
wider with no identity configured warns loudly).

### Credentials in deployment: `graft harden` (P7.1)

The approval-hardening role split (see
[`approval-hardening.md`](./approval-hardening.md)) becomes a one-liner:
`graft harden <role>` (run with the operator `DATABASE_URL`) grants an
existing role the runtime privilege set. The deployment recipe every adapter
doc will repeat:

```
CREATE ROLE graft_runtime LOGIN PASSWORD '…';   -- operator / provider console
graft harden graft_runtime                      -- operator credential
# deploy `graft serve` with the graft_runtime URL as DATABASE_URL
```

`graft serve` under the hardened role can execute every mounted endpoint but
can never decide an approval — the human gate survives handing the whole
process to an agent.

## Container topology (P7.2 — SHIPPED, `deploy/docker/`)

- **Single container (dev):** one image = Postgres 18 + MinIO + `graft serve`.
  Base is the official `postgres:18` (its entrypoint owns initdb) + Node 24 +
  MinIO/mc binaries copied from their official images (registry pulls —
  `dl.min.io` doesn't resolve on every network). Boot:
  [infra] → bucket → migrate → compile → [harden] → serve. With nothing
  mounted it serves the baked-in example project and **generates + logs a dev
  token** (`GRAFT_MCP_REQUIRE_AUTH` defaults to `1` — the container never
  exposes anonymous MCP). One `docker run`, full backend, no external
  services — the compare-page claim, kept honest.
- **Mounted projects:** `/project` (graft.config.ts + content/) is served
  instead; the entrypoint symlinks `/project/node_modules` to the
  `deploy/docker/project` workspace shim so `@graft/core`/`zod` imports
  resolve (pre-1.0: unpublished packages — the image supplies them). MCP
  writes land in the mounted tree; git stays authoritative on the host.
- **Hardened mode:** `GRAFT_RUNTIME_PASSWORD` makes boot create the role,
  `graft harden` it, and serve under it. Trade-off (deliberate): the hardened
  credential cannot project content, so MCP `write_content`/`delete_content`
  need the operator credential — enable it for functions/reads-first
  deployments. Reopens if a vertical needs authored-content writes under
  runtime creds (a grants-v2 decision).
- **Split compose (scale):** `deploy/docker/compose.yml` — `db`/`storage`/
  `graft` services; the graft service runs `GRAFT_MODE=serve` against them.
  Managed swap is env-only (Neon URL, R2 `S3_*`, `GRAFT_ENSURE_BUCKET=0`).
- The monorepo is unpublished (pre-1.0), so the image builds the workspace
  itself (packages-only turbo build — the example app's Next build has no
  business in the image); when packages publish, the Dockerfile slims to
  `npm i @graft/cli` + the user's project. The Dockerfile is in
  `.dockerignore` so editing it doesn't bust the workspace-install cache.

**Verified live (2026-07-11, Docker Desktop 29.5.3):** all-in-one boots to
healthy (initdb → MinIO → bucket → migrations → compile → serve; healthz
reports 5 collections / 13 functions), `pageStats` serves compiled content,
`ROUTE_NOT_FOUND` teaches, MCP anonymous 401 → generated-bearer initialize OK;
hardened mode serves functions as `graft_runtime` while raw
`UPDATE approvals` inside the container gets `permission denied`; split
compose (db + storage + graft) migrates/compiles against the external
services and serves the same answers.

## Deploy adapters (P7.3 — SHIPPED, `deploy/*.md`)

Docs + env recipes, not code — the handlers already run anywhere Web-standard
requests do: Railway/Fly/VPS run the container; **Vercel** stays the embedded
topology (Functions/Fluid is request-scoped compute, not a container host —
banked finding, 2026-07-04). Each adapter doc carries the harden recipe;
`deploy/README.md` is the chooser + the shared credential/who-runs-what
tables. Adapter-specific calls worth remembering: Fly scale-to-zero is safe
(stateless handlers; boot compile is a hash-diff no-op), Vercel compile is a
**build step** (read-only deployed filesystem) and needs the operator
credential piped into the build script (`DATABASE_URL=$GRAFT_OPERATOR_DATABASE_URL
graft compile && next build`) since Vercel shares env between build and
runtime, and `graft harden` covers Graft's tables only — app-owned tables
(e.g. Better Auth's) get granted separately.

## Astro / SvelteKit SDKs (P7.4 — SHIPPED)

`@graft/sdk-astro` and `@graft/sdk-sveltekit`: the identical
`createGraft` → `getContent`/`listContent`/`searchContent` surface as
sdk-next (same type-inference pins), plus `graftRoute` — the handler mount,
which is one property access because both frameworks' endpoints are already
Web-standard (`{ request }` → the handler). Typed **structurally**, so
neither package depends on astro or @sveltejs/kit.

Honest divergences from sdk-next, by framework reality:

- **No request memo** — React.cache has no equivalent; reads go straight to
  Postgres (prerendered pages read at build time anyway).
- **No tag-based data cache** — the Phase 4 tag contract maps onto HTTP
  instead: stamp `tagsFor(...)` into a CDN surrogate-key header
  (`Cache-Tag`/`Surrogate-Key`), purge `tagsForChanges(branch, changeSet)`
  from the compile webhook. The tags are re-exported; purge clients are the
  CDN's business, not Graft's.
- **No MdxBody** — that component is React; bodies come back as authored MDX
  source for the framework's own pipeline (@astrojs/mdx, mdsvex). A deeper
  MDX story per framework is a launch-feedback decision, not a preemptive
  build.

## Later units

- **Docs site + compare page (P7.5):** the PRD §5 table, kept honest by the
  shipped surface; example gallery grows from `examples/`.
