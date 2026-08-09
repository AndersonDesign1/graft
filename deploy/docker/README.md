# Graft in a container (P7.2)

Two topologies, one image, decided in
[`docs/design-notes/packaging.md`](../../docs/design-notes/packaging.md).
Pre-1.0 the `@usegraft/*` packages are unpublished, so the image builds the
workspace itself — build from the **repo root**:

```sh
docker build -f deploy/docker/Dockerfile -t graft .
```

## Single container (dev) — the whole backend in one `docker run`

```sh
docker run --init -p 3903:3903 -v graft_pg:/var/lib/postgresql -v graft_minio:/data graft
```

Boot order: embedded Postgres 18 + MinIO → schema migrations → `graft compile`
→ (optional hardening) → `graft serve`. With no project mounted it serves the
baked-in example project — the logs print a generated `GRAFT_DEV_TOKEN`; use it
as a bearer:

```sh
curl http://localhost:3903/healthz
curl -X POST http://localhost:3903/api/fn/pageStats -H "content-type: application/json" -d "{}"
# MCP endpoint (requires the bearer by default): POST http://localhost:3903/api/mcp
```

Serve your own project (a directory with `graft.config.ts` + `content/`):

```sh
docker run --init -p 3903:3903 -v ./my-site:/project -v graft_pg:/var/lib/postgresql graft
```

The entrypoint symlinks `/project/node_modules` to the image's packages (the
`deploy/docker/project` shim) so your config's `@usegraft/core` / `zod` imports
resolve. Content written over MCP lands in your mounted tree — commit it from
the host; git stays authoritative.

## Split compose (scale)

```sh
cd deploy/docker && docker compose up --build
```

`db` / `storage` / `graft` as separate services. The managed swap is
environment, not code: delete `db` and point `DATABASE_URL` at Neon, delete
`storage` and point `S3_*` at R2 (set `GRAFT_ENSURE_BUCKET=0` when the bucket
is managed elsewhere).

## Environment reference

| Variable                                                        | Default            | What                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRAFT_MODE`                                                    | `all-in-one`       | `serve` skips embedded Postgres/MinIO (then `DATABASE_URL` is required)                                                                                                                                                                                                                            |
| `DATABASE_URL`                                                  | embedded PG        | Operator credential: migrations + compile (+ serve, unless hardened)                                                                                                                                                                                                                               |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | embedded MinIO     | Asset store; swap to R2 by env                                                                                                                                                                                                                                                                     |
| `GRAFT_DEV_TOKEN` / `GRAFT_DEV_SCOPES`                          | generated / empty  | Static bearer identity; a fresh token is generated (and logged) when no identity is configured                                                                                                                                                                                                     |
| `GRAFT_TRUSTED_ISSUERS`                                         | —                  | Comma-separated OIDC issuer URLs (JWKS via discovery)                                                                                                                                                                                                                                              |
| `GRAFT_MCP_REQUIRE_AUTH`                                        | `1`                | The container never exposes anonymous MCP by default                                                                                                                                                                                                                                               |
| `GRAFT_APPROVAL_POLICY`                                         | `none`             | `human` gates every mutation                                                                                                                                                                                                                                                                       |
| `GRAFT_RUNTIME_PASSWORD` (+ `GRAFT_RUNTIME_ROLE`)               | —                  | Opt-in hardening: create + `graft harden` the role, then serve under it — the serving credential can request/consume approvals but **never decide them**. Trade-off: content projection stays operator-only, so MCP `write_content`/`delete_content` are unavailable under the hardened credential |
| `PORT` / `HOST`                                                 | `3903` / `0.0.0.0` | Bind address for `graft serve`                                                                                                                                                                                                                                                                     |
| `GRAFT_ENSURE_BUCKET`                                           | `1`                | `mc mb --ignore-existing` at boot; disable for managed buckets                                                                                                                                                                                                                                     |
