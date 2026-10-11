#!/usr/bin/env bash
# Create a disposable Graft project to verify against, built from this
# checkout's CLI. Prints the project path on the last line.
#
#   sandbox.sh                 static project (no database)
#   sandbox.sh --postgres      Postgres project, on a disposable local server
#
# Never points at the environment's DATABASE_URL. A cloud session may carry
# one for a real database; verification must not touch it.
set -euo pipefail

case "${1:-}" in
  "" | --postgres) ;;
  *)
    echo "usage: sandbox.sh [--postgres]" >&2
    exit 2
    ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
cli="$repo/packages/cli/dist/index.js"
base="${GRAFT_VERIFY_DIR:-${TMPDIR:-/tmp}/graft-verify}"
mkdir -p "$base"
base="$(cd "$base" && pwd)"
run="$base/run-$(date +%s)-$$"
mkdir -p "$run"

if [[ ! -f "$cli" ]]; then
  echo "sandbox: $cli is missing. Build first: pnpm -r --filter @usegraft/cli... run build" >&2
  exit 1
fi

# A failed step must not leave a server running with no path printed to stop it.
stop_pg() {
  if [[ -f "$run/pg/datadir" ]]; then "$here/pg.sh" down "$run/pg" || true; fi
}
trap stop_pg ERR

cd "$run"
env -u DATABASE_URL node "$cli" init . >/dev/null
# The scaffold imports @usegraft/core; borrow the workspace's installed copy.
ln -s "$repo/examples/docs-site/node_modules" node_modules

if [[ "${1:-}" == "--postgres" ]]; then
  "$here/pg.sh" up "$run/pg" >/dev/null
  (umask 077 && echo "DATABASE_URL=$(cat "$run/pg/url")" > .env)
  # A temporary file rather than `sed -i`, whose flags differ between GNU and BSD.
  sed 's/export const index = "static"/export const index = "postgres"/' graft.config.ts > graft.config.ts.tmp
  mv graft.config.ts.tmp graft.config.ts
  DATABASE_URL="$(cat "$run/pg/url")" node "$cli" db migrate >/dev/null
fi

env -u DATABASE_URL node "$cli" compile >/dev/null
echo "$run"
