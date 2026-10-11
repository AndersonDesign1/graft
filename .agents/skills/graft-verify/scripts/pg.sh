#!/usr/bin/env bash
# A throwaway local Postgres for verification.
#
#   pg.sh up <dir>     start one; writes <dir>/url
#   pg.sh down <dir>   stop it (its data directory, named in <dir>/datadir, stays until you delete it)
#
# Uses the system's PostgreSQL 16 binaries on a free port from 54330. Runs as
# the `postgres` user when invoked as root, because Postgres refuses root.
set -euo pipefail

cmd="${1:?usage: pg.sh up|down <dir>}"
dir="${2:?usage: pg.sh up|down <dir>}"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[[ -x "$bin/pg_ctl" ]] || { echo "pg.sh: no PostgreSQL binaries found; set PG_BIN" >&2; exit 1; }

as_pg() {
  if [[ "$(id -u)" == 0 ]]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi
}

case "$cmd" in
  up)
    mkdir -p "$dir"
    # The server's files live where the postgres user can reach them; <dir>
    # only records where.
    data="$(mktemp -d "${TMPDIR:-/tmp}/graft-pg.XXXXXX")"
    chmod 755 "$data"
    [[ "$(id -u)" == 0 ]] && chown postgres "$data"
    echo "$data" > "$dir/datadir"
    port=54330
    while (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done
    as_pg "'$bin/initdb' -D '$data/data' -U postgres --auth=trust >/dev/null"
    as_pg "'$bin/pg_ctl' -D '$data/data' -o \"-p $port -k '$data' -c listen_addresses=127.0.0.1\" -l '$data/log' -w start >/dev/null"
    echo "postgres://postgres@127.0.0.1:$port/postgres" > "$dir/url"
    cat "$dir/url"
    ;;
  down)
    data="$(cat "$dir/datadir")"
    as_pg "'$bin/pg_ctl' -D '$data/data' -m fast stop >/dev/null" || true
    ;;
  *)
    echo "usage: pg.sh up|down <dir>" >&2
    exit 2
    ;;
esac
