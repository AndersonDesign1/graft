#!/usr/bin/env bash
# Run a command with the database, Neon, S3/AWS/R2 and GitHub credentials
# removed from its environment, so a test or a CLI call cannot reach a real
# database, Neon project, bucket or GitHub repository by accident.
#
#   offline.sh pnpm test
#   offline.sh --db <url> env RUN_INTEGRATION=1 pnpm --filter @usegraft/db exec vitest run
#
# --db sets DATABASE_URL to the given URL (a throwaway from pg.sh) after the
# scrub. A cloud session's environment can hold live keys, and an integration
# run without this has created a real Neon branch before.
set -euo pipefail

db=""
if [[ "${1:-}" == "--db" ]]; then
  db="${2:?offline.sh --db needs a URL}"
  shift 2
fi
[[ $# -gt 0 ]] || { echo "usage: offline.sh [--db <url>] <command> [args...]" >&2; exit 2; }

repo="$(cd "$(dirname "$0")/../../../.." && pwd)"
if [[ -f "$repo/.env" ]]; then
  # Integration tests load the repo-root .env themselves, after this scrub.
  echo "offline.sh: $repo/.env exists and tests load it directly. Move it aside first." >&2
  exit 1
fi

unset_args=()
while IFS='=' read -r name _; do
  case "$name" in
    DATABASE_URL | *NEON* | S3_* | AWS_* | R2_* | \
      GITHUB_TOKEN | GH_TOKEN | GRAFT_GITHUB_* | GRAFT_STUDIO_* | GRAFT_DEV_TOKEN)
      unset_args+=(-u "$name")
      ;;
  esac
done < <(env)

# Unsetting the keys is not enough for AWS: the SDKs also read a profile from
# ~/.aws and ask the instance metadata service. Point both at nothing.
no_aws=(AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true)

if [[ -n "$db" ]]; then
  exec env "${unset_args[@]}" "${no_aws[@]}" DATABASE_URL="$db" "$@"
fi
exec env "${unset_args[@]}" "${no_aws[@]}" "$@"
