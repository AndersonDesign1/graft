# Graft on Railway (container topology)

Railway builds the repo's Dockerfile and runs it as a service; Postgres is a
Railway plugin (or Neon); assets go to R2 (Railway has no S3-compatible
store).

## 1. Service

- New service → deploy from your repo (a fork of this workspace with your
  project baked at `/project`, or the example as-is).
- Set the Dockerfile path: `deploy/docker/Dockerfile`.
- Railway injects `PORT`; `graft serve` honors it — no config needed.

## 2. Database

Add the Railway Postgres plugin (or use Neon) and run the schema migrations
once from your machine with the plugin's connection string:

```sh
DATABASE_URL=<railway-postgres-url> pnpm --filter @usegraft/db db:migrate
```

## 3. Environment

```sh
GRAFT_MODE=serve                 # no embedded Postgres/MinIO in the dyno
DATABASE_URL=<runtime-role-url>  # see the credential recipe in deploy/README.md
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
S3_BUCKET=graft-assets
S3_PUBLIC_URL=https://assets.example.com   # optional: stable public asset URLs
GRAFT_ENSURE_BUCKET=0            # R2 buckets are managed in Cloudflare
GRAFT_DEV_TOKEN=…                # or GRAFT_TRUSTED_ISSUERS=https://your-idp
```

`GRAFT_MCP_REQUIRE_AUTH` already defaults to `1` in the image — the MCP
endpoint rejects anonymous callers unless you opt out.

## 4. Harden (recommended)

Follow the credential recipe in [`deploy/README.md`](./README.md): create
`graft_runtime` against the Railway/Neon database, `graft harden graft_runtime`
as the operator, and set the service's `DATABASE_URL` to the runtime role's
URL. Approvals then require a human with the operator credential —
`graft approvals` / `graft approve <id>` from your machine.

## 5. Verify

```sh
curl https://<service>.up.railway.app/healthz
curl -X POST https://<service>.up.railway.app/api/fn/<name> \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d "{}"
```

Content updates: edit MDX → commit → Railway redeploys → the boot compile
projects the new tree. (The audit log records the serving git SHA per
invocation.)
