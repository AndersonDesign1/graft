#!/usr/bin/env bash
# Graft container boot (P7.2): [infra] → migrate → compile → [harden] → serve.
#
# GRAFT_MODE=all-in-one (default): start embedded Postgres 18 + MinIO first.
# GRAFT_MODE=serve: DATABASE_URL (+ S3_*) point at external services.
#
# Project: /project when mounted (graft.config.ts + content/), else the baked
# example. Mounted projects get a node_modules symlink into the workspace's
# resolution shim (deploy/docker/project) — pre-1.0 the @graft/* packages are
# unpublished, so the image provides them.
set -euo pipefail

log() { echo "[graft] $*"; }

GRAFT_MODE="${GRAFT_MODE:-all-in-one}"
PORT="${PORT:-3903}"

# ── Embedded infra (all-in-one) ─────────────────────────────────────────────
if [ "$GRAFT_MODE" = "all-in-one" ]; then
  log "starting embedded Postgres 18…"
  # The official image's entrypoint: initdb on first boot, then postgres.
  docker-entrypoint.sh postgres &

  log "starting embedded MinIO…"
  mkdir -p /data
  minio server /data --address ":9000" --console-address ":9001" &

  export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}}"

  for i in $(seq 1 60); do
    pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q && break
    [ "$i" = 60 ] && { log "Postgres did not become ready"; exit 1; }
    sleep 1
  done
  log "Postgres is ready"

  for i in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:9000/minio/health/live" >/dev/null 2>&1 && break
    [ "$i" = 60 ] && { log "MinIO did not become ready"; exit 1; }
    sleep 1
  done
  log "MinIO is ready"
fi

: "${DATABASE_URL:?DATABASE_URL is required in GRAFT_MODE=serve (point it at your Postgres)}"

# ── Asset bucket (idempotent; skip with GRAFT_ENSURE_BUCKET=0 for R2 etc.) ──
if [ "${GRAFT_ENSURE_BUCKET:-1}" = "1" ]; then
  mc alias set graftlocal "$S3_ENDPOINT" "${MINIO_ROOT_USER:-$S3_ACCESS_KEY}" "${MINIO_ROOT_PASSWORD:-$S3_SECRET_KEY}" >/dev/null 2>&1 \
    && mc mb --ignore-existing "graftlocal/${S3_BUCKET}" >/dev/null 2>&1 \
    && log "asset bucket ${S3_BUCKET} ready" \
    || log "WARNING: could not ensure bucket ${S3_BUCKET} (set GRAFT_ENSURE_BUCKET=0 if it is managed elsewhere)"
fi

# ── Project selection ───────────────────────────────────────────────────────
if [ -f /project/graft.config.ts ]; then
  PROJECT_DIR=/project
  if [ ! -e /project/node_modules ]; then
    ln -s /opt/graft/deploy/docker/project/node_modules /project/node_modules
    log "linked /project/node_modules → the image's @graft/* packages (pre-1.0: unpublished)"
  fi
else
  PROJECT_DIR=/opt/graft/examples/landing-page
  log "no project mounted at /project — serving the example project"
fi
cd "$PROJECT_DIR"

# ── migrate → compile (operator credential) ─────────────────────────────────
log "applying schema migrations…"
node /opt/graft/packages/db/scripts/migrate.mjs

log "compiling authored content…"
graft compile

# ── Optional hardening: serve under a runtime role that can never decide
# approvals. Trade-off (documented in packaging.md): the hardened role also
# cannot project content, so MCP write_content/delete_content need the
# operator credential — enable this when the container's callers are
# functions/reads-first.
if [ -n "${GRAFT_RUNTIME_PASSWORD:-}" ]; then
  ROLE="${GRAFT_RUNTIME_ROLE:-graft_runtime}"
  log "hardening runtime role ${ROLE}…"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN; END IF; END \$\$;" \
    -c "ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${GRAFT_RUNTIME_PASSWORD}';"
  graft harden "$ROLE"
  export DATABASE_URL="$(node -e "
    const u = new URL(process.env.DATABASE_URL);
    u.username = process.env.GRAFT_RUNTIME_ROLE || 'graft_runtime';
    u.password = process.env.GRAFT_RUNTIME_PASSWORD;
    console.log(u.href);
  ")"
  log "serving as ${ROLE} (cannot decide approvals; content projection stays operator-only)"
fi

# ── Identity defaults: never expose an unauthenticated MCP surface ──────────
export GRAFT_MCP_REQUIRE_AUTH="${GRAFT_MCP_REQUIRE_AUTH:-1}"
if [ -z "${GRAFT_DEV_TOKEN:-}" ] && [ -z "${GRAFT_TRUSTED_ISSUERS:-}" ]; then
  export GRAFT_DEV_TOKEN="$(openssl rand -hex 24)"
  log "no identity configured — generated a dev token for this run:"
  log "  GRAFT_DEV_TOKEN=${GRAFT_DEV_TOKEN}"
  log "  (set GRAFT_DEV_TOKEN or GRAFT_TRUSTED_ISSUERS yourself for a stable identity)"
fi

log "starting graft serve on :${PORT} (project: ${PROJECT_DIR})"
exec graft serve --host "${HOST:-0.0.0.0}" --port "$PORT"
