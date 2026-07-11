# Graft on Fly.io (container topology)

Fly builds the Dockerfile into a Machine. Use Fly Postgres (or Neon) for the
database and Tigris (Fly's S3-compatible storage) or R2 for assets.

## fly.toml

```toml
app = "my-graft"
primary_region = "fra"

[build]
  dockerfile = "deploy/docker/Dockerfile"

[env]
  GRAFT_MODE = "serve"
  PORT = "3903"
  S3_BUCKET = "graft-assets"
  GRAFT_ENSURE_BUCKET = "0"

[http_service]
  internal_port = 3903
  force_https = true
  auto_stop_machines = "stop"     # graft serve is stateless — scale-to-zero is safe
  auto_start_machines = true

[checks.health]
  type = "http"
  port = 3903
  path = "/healthz"
  interval = "15s"
  timeout = "5s"
  grace_period = "60s"            # boot runs migrate + compile before serving
```

## Secrets

```sh
fly secrets set \
  DATABASE_URL=<runtime-role-url> \
  S3_ENDPOINT=https://fly.storage.tigris.dev \
  S3_ACCESS_KEY=… S3_SECRET_KEY=… \
  GRAFT_DEV_TOKEN=…              # or GRAFT_TRUSTED_ISSUERS=https://your-idp
```

`fly storage create` provisions Tigris and prints the S3 credentials; R2 works
identically (swap the endpoint). Run migrations once from your machine with
the operator URL:

```sh
DATABASE_URL=<operator-url> pnpm --filter @graft/db db:migrate
```

## Harden (recommended)

The credential recipe in [`deploy/README.md`](./README.md): `CREATE ROLE
graft_runtime LOGIN PASSWORD '…'` + `graft harden graft_runtime` as the
operator, then the `DATABASE_URL` secret above is the runtime role's URL.
Humans decide approvals from outside the deployment (`graft approve <id>` with
the operator credential).

## Notes

- **Scale-to-zero:** every handler is stateless (the P3 invariant), so
  `auto_stop_machines` costs nothing but cold-start latency; the boot compile
  reruns on start and is a no-op when content is unchanged (hash-diff).
- **All-in-one on Fly** (embedded Postgres/MinIO + a Fly volume) works for
  throwaway previews, but pinning data to one Machine defeats Fly's model —
  prefer `serve` mode with managed data.
