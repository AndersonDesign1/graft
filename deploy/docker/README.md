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
→ harden → `graft serve`. With no project mounted it serves the
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

### Deciding approvals from the box

The container serves under the hardened `graft_runtime` role, which **cannot
decide an approval**. That is the point of the layer, and it means `graft
approve` needs the operator credential explicitly:

```sh
docker exec <container> graft approvals
docker exec <container> env DATABASE_URL=postgres://graft:graft@127.0.0.1:5432/graft graft approve <id>
```

The operator user, password and database come from `POSTGRES_USER`,
`POSTGRES_PASSWORD` and `POSTGRES_DB` (`graft`/`graft`/`graft` unless you
override them). Set `GRAFT_HARDEN=0` to serve under the operator credential
instead, which makes `graft approve` work with no extra argument and gives up
the layer.

## Split compose (scale)

```sh
cd deploy/docker && docker compose up --build
```

`db` / `storage` / `graft` as separate services. The managed swap is
environment, not code: delete `db` and point `DATABASE_URL` at Neon, delete
`storage` and point `S3_*` at R2 (set `GRAFT_ENSURE_BUCKET=0` when the bucket
is managed elsewhere).

## Environment reference

| Variable                                                        | Default                     | What                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRAFT_MODE`                                                    | `all-in-one`                | `serve` skips embedded Postgres/MinIO (then `DATABASE_URL` is required)                                                                                                                                                                                                                                                                  |
| `DATABASE_URL`                                                  | embedded PG                 | Operator credential: migrations + compile (+ serve, unless hardened)                                                                                                                                                                                                                                                                     |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` | embedded MinIO              | Asset store; swap to R2 by env                                                                                                                                                                                                                                                                                                           |
| `GRAFT_DEV_TOKEN` / `GRAFT_DEV_SCOPES`                          | generated / empty           | Static bearer identity; a fresh token is generated (and logged) when no identity is configured                                                                                                                                                                                                                                           |
| `GRAFT_TRUSTED_ISSUERS`                                         | —                           | Comma-separated OIDC issuer URLs (JWKS via discovery)                                                                                                                                                                                                                                                                                    |
| `GRAFT_MCP_ALLOW_ANONYMOUS`                                     | `0`                         | The container never exposes anonymous MCP by default                                                                                                                                                                                                                                                                                     |
| `approvalPolicy` — in `graft.config.ts`, not the environment    | `none`                      | `human` gates every mutation                                                                                                                                                                                                                                                                                                             |
| `GRAFT_HARDEN`                                                  | `1` all-in-one, `0` serve   | Create + `graft harden` the runtime role, then serve under it. The serving credential reads, runs functions, projects content, and requests approvals, but **can never decide one**. On by default where the container owns the database; in `GRAFT_MODE=serve` the database is yours, so set this or `GRAFT_RUNTIME_PASSWORD` to opt in |
| `GRAFT_RUNTIME_PASSWORD` (+ `GRAFT_RUNTIME_ROLE`)               | generated / `graft_runtime` | The hardened role's password. Setting it also turns hardening on. Left unset in all-in-one, a per-boot secret is generated and never logged                                                                                                                                                                                              |
| `PORT` / `HOST`                                                 | `3903` / `0.0.0.0`          | Bind address for `graft serve`                                                                                                                                                                                                                                                                                                           |
| `GRAFT_ENSURE_BUCKET`                                           | `1`                         | `mc mb --ignore-existing` at boot; disable for managed buckets                                                                                                                                                                                                                                                                           |
