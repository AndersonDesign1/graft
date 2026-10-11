#!/usr/bin/env bash
# A throwaway local Postgres for verification.
#
#   pg.sh up <dir>     start one; writes <dir>/url
#   pg.sh down <dir>   stop it (its data directory, named in <dir>/datadir, stays until you delete it)
#
# Uses the newest PostgreSQL under /usr/lib/postgresql (or $PG_BIN) on a free
# port from 54330, listening on 127.0.0.1 only, with a random password that
# exists only in <dir>/url. Runs the server as the `postgres` user when
# invoked as root, because Postgres refuses root.
set -euo pipefail

cmd="${1:?usage: pg.sh up|down <dir>}"
dir="${2:?usage: pg.sh up|down <dir>}"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[[ -n "$bin" && -x "$bin/pg_ctl" ]] || { echo "pg.sh: no PostgreSQL binaries found; set PG_BIN" >&2; exit 1; }

# Run a program as the server's owner. Arguments pass through as-is, never
# through a shell, so a path cannot inject a command.
as_pg() {
  if [[ "$(id -u)" == 0 ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}

case "$cmd" in
  up)
    mkdir -p "$dir"
    # The server's files live under /tmp, which the postgres user can always
    # traverse (a private $TMPDIR may not be); <dir> only records where.
    data="$(mktemp -d /tmp/graft-pg.XXXXXX)"
    chmod 755 "$data"
    password="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
    printf '%s\n' "$password" > "$data/pwfile"
    if [[ "$(id -u)" == 0 ]]; then chown -R postgres "$data"; fi
    echo "$data" > "$dir/datadir"
    port=54330
    while (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done
    as_pg "$bin/initdb" -D "$data/data" -U postgres --auth=scram-sha-256 --pwfile="$data/pwfile" >/dev/null
    rm -f "$data/pwfile"
    as_pg "$bin/pg_ctl" -D "$data/data" -o "-p $port -k $data -c listen_addresses=127.0.0.1" \
      -l "$data/log" -w start >/dev/null
    (umask 077 && echo "postgres://postgres:$password@127.0.0.1:$port/postgres" > "$dir/url")
    cat "$dir/url"
    ;;
  down)
    [[ -f "$dir/datadir" ]] || { echo "pg.sh: nothing started in $dir" >&2; exit 0; }
    data="$(cat "$dir/datadir")"
    # Already stopped is fine; a stop that fails is not.
    if as_pg "$bin/pg_ctl" -D "$data/data" status >/dev/null 2>&1; then
      as_pg "$bin/pg_ctl" -D "$data/data" -m fast stop >/dev/null
    fi
    ;;
  *)
    echo "usage: pg.sh up|down <dir>" >&2
    exit 2
    ;;
esac
