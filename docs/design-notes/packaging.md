# Packaging & deploy topology (Phase 7)

**Status: P7.0 decided · P7.1 (`graft serve` + `graft harden`) SHIPPED.**
Remaining units (container image, compose split, deploy adapter docs, SDKs,
docs site) build on the decisions here.

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

## Container topology (P7.2, next)

- **Single container (dev):** one image = Postgres 18 + MinIO + `graft serve`
  over a mounted project dir (`/project`), process-supervised; boot order:
  migrate → compile → harden → serve. One `docker run`, full backend. This is
  the compare-page claim ("one container dev") and must stay honest: no
  external services required.
- **Split compose (scale):** the same three as services (`db`, `storage`,
  `graft`), each swappable for managed equivalents (Neon / R2) by env alone —
  the codebase is already pooler-aware and S3-generic, so the compose file is
  configuration, not code.
- The monorepo is unpublished (pre-1.0), so the image builds from the
  workspace (`deploy/docker/`); when packages publish, the Dockerfile slims to
  `npm i @graft/cli` + the user's project.

## Deploy adapters (P7.3)

Docs + env recipes, not code — the handlers already run anywhere Web-standard
requests do: Railway/Fly/VPS run the container; **Vercel** stays the embedded
topology (Functions/Fluid is request-scoped compute, not a container host —
banked finding, 2026-07-04). Each adapter doc carries the harden recipe above.

## Later units

- **Astro / SvelteKit SDKs (P7.4):** thin adapters over `sdk-core` reads +
  mounting the two handlers, mirroring `sdk-next`'s split (reads via the
  framework's cache primitive; tags from `tagsFor`/`tagsForChanges`).
- **Docs site + compare page (P7.5):** the PRD §5 table, kept honest by the
  shipped surface; example gallery grows from `examples/`.
