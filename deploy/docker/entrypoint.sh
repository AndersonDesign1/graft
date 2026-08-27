#!/usr/bin/env bash
# Graft container boot (P7.2): [infra] → migrate → compile → [harden] → serve.
#
# GRAFT_MODE=all-in-one (default): start embedded Postgres 18 + MinIO first.
# GRAFT_MODE=serve: DATABASE_URL (+ S3_*) point at external services.
#
# Project: /project when mounted (graft.config.ts + content/), else the baked
# example. Mounted projects get a node_modules symlink into the workspace's
# resolution shim (deploy/docker/project) — pre-1.0 the @usegraft/* packages are
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
    log "linked /project/node_modules → the image's @usegraft/* packages (pre-1.0: unpublished)"
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

# ── Hardening: serve under a runtime role that can never decide approvals.
# Default ON in all-in-one, where the container owns the database and creates
# the role in a cluster that is nothing but its own. In GRAFT_MODE=serve the
# database belongs to the operator, and altering a role on every boot is not a
# defensible default, so it stays opt-in there: set GRAFT_RUNTIME_PASSWORD.
# GRAFT_HARDEN=0 turns it off anywhere.
#
# This used to cost the deployment its MCP content writes, which is why it was
# opt-in everywhere. The runtime role projects content now, so it costs nothing.
# Supplying a password is itself an opt-in, in either mode. An explicit
# GRAFT_HARDEN always wins, so a password left in a compose file does not
# override someone deliberately turning hardening off.
if [ "$GRAFT_MODE" = "all-in-one" ] || [ -n "${GRAFT_RUNTIME_PASSWORD:-}" ]; then
  HARDEN_DEFAULT=1
else
  HARDEN_DEFAULT=0
fi
GRAFT_HARDEN="${GRAFT_HARDEN:-$HARDEN_DEFAULT}"

if [ "$GRAFT_HARDEN" = "1" ]; then
  ROLE="${GRAFT_RUNTIME_ROLE:-graft_runtime}"
  # No password given: the embedded database is the container's own, so a
  # per-boot secret is the right default. Nothing outside connects as this
  # role, and leaving it unlogged keeps it out of the container's output.
  GRAFT_RUNTIME_PASSWORD="${GRAFT_RUNTIME_PASSWORD:-$(openssl rand -hex 24)}"
  export GRAFT_RUNTIME_ROLE="$ROLE"
  log "hardening runtime role ${ROLE}…"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN; END IF; END \$\$;" \
    -c "ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${GRAFT_RUNTIME_PASSWORD}';"
  graft harden "$ROLE"
  # One-shot env prefix, not an export: the password already travels in
  # DATABASE_URL, and `graft serve` has no reason to hold a second copy.
  export DATABASE_URL="$(GRAFT_RUNTIME_PASSWORD="$GRAFT_RUNTIME_PASSWORD" node -e "
    const u = new URL(process.env.DATABASE_URL);
    u.username = process.env.GRAFT_RUNTIME_ROLE || 'graft_runtime';
    u.password = process.env.GRAFT_RUNTIME_PASSWORD;
    console.log(u.href);
  ")"
  log "serving as ${ROLE} (serves, projects content, requests approvals — never decides one)"
fi

# ── Identity defaults: never expose an unauthenticated MCP surface ──────────
# Anonymous MCP is refused unless explicitly allowed; the container never
# opts in. (Replaces GRAFT_MCP_REQUIRE_AUTH=1, which is now the default.)
export GRAFT_MCP_ALLOW_ANONYMOUS="${GRAFT_MCP_ALLOW_ANONYMOUS:-0}"
if [ -z "${GRAFT_DEV_TOKEN:-}" ] && [ -z "${GRAFT_TRUSTED_ISSUERS:-}" ]; then
  export GRAFT_DEV_TOKEN="$(openssl rand -hex 24)"
  log "no identity configured — generated a dev token for this run:"
  log "  GRAFT_DEV_TOKEN=${GRAFT_DEV_TOKEN}"
  log "  (set GRAFT_DEV_TOKEN or GRAFT_TRUSTED_ISSUERS yourself for a stable identity)"
fi

log "starting graft serve on :${PORT} (project: ${PROJECT_DIR})"
exec graft serve --host "${HOST:-0.0.0.0}" --port "$PORT"
