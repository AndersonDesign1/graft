---
name: graft-verify
description: Prove a Graft change works by driving the real thing, the way a user or agent would. Covers the CLI (init, compile, errors), the MCP server over stdio, the docs site, and Studio, in a disposable project with no shared database. Use before saying a change works, when reproducing a bug, or when a review asks "did you run it?".
---

# Verify Graft

Tests prove branches. This proves behavior. Read it cold: you need nothing
else to launch, drive, capture evidence and clean up.

## Rules

- **Never reach a real service.** A cloud session's environment can hold
  live credentials (`DATABASE_URL`, `NEON_API_KEY`, `S3_*`, `GITHUB_TOKEN`).
  Run every CLI call, test and script through `scripts/offline.sh`, which
  removes them, and give it a throwaway database with `--db` when you need
  one. An integration run without it has created a real Neon branch
  before.
- **Never drive an instance you did not start.** Kill what you started, by
  PID or by `pg.sh down`, never by process name.
- **Use this checkout's CLI**, `node packages/cli/dist/index.js`, not a
  published `npx @usegraft/cli`. Build it first if `dist/` is stale.
- **Proof is the action and the result.** The command, its output and exit
  code, and a second, read-only look at the state it changed (the file on
  disk, the row in the index, the page in the browser).
- **"Inconclusive" is not a pass.** Neither is a check on a different
  surface than the one the change touched. Say so.

## Launch

Build what you changed, then make a sandbox:

```sh
REPO=$(git rev-parse --show-toplevel)
O=$REPO/.agents/skills/graft-verify/scripts/offline.sh
pnpm -r --filter @usegraft/cli... run build      # or the package you touched, plus its dependents
P=$(.agents/skills/graft-verify/scripts/sandbox.sh | tail -1)             # static project
P=$(.agents/skills/graft-verify/scripts/sandbox.sh --postgres | tail -1)  # Postgres project
```

`sandbox.sh` runs `graft init`, links the workspace's `node_modules`, compiles
once, and prints the project path. With `--postgres` it also starts a local
PostgreSQL on a free port from 54330, writes `.env` with its URL, and runs
`graft db migrate`. Set `GRAFT_VERIFY_DIR` to choose where sandboxes go
(default `$TMPDIR/graft-verify`).

Turbo can fail in cloud containers with `Exec format error`. Use
`pnpm -r --filter <pkg>... run build` instead of `pnpm build` when it does.

## Doctor

Run before driving, and whenever something looks off:

```sh
cd "$P"
node "$REPO/packages/cli/dist/index.js" --help | head -1     # "graft — the agent-native CMS"
test -f .graft/index.db && echo static-index-ok             # static only
cat pg/url 2>/dev/null                                       # Postgres only: the throwaway URL
```

## Drive

Pick the feature file for the surface your change touched, and follow its
recipe. Prefix every command with `$O` unless the recipe says otherwise. Cover every entry point the file lists, not only the convenient one.

| Surface | Feature file |
| --- | --- |
| `graft init`, `graft compile`, CLI errors | [features/cli.md](features/cli.md) |
| The MCP server and its tools | [features/mcp.md](features/mcp.md) |
| The docs site (`examples/docs-site`) | [features/docs-site.md](features/docs-site.md) |
| Studio | [features/studio.md](features/studio.md) |

### Integration tests

The `*.integration.test.ts` suites run against a throwaway Postgres:

```sh
mkdir -p "$P/itest" && URL=$(.agents/skills/graft-verify/scripts/pg.sh up "$P/itest")
.agents/skills/graft-verify/scripts/offline.sh --db "$URL" \
  env RUN_INTEGRATION=1 pnpm --filter @usegraft/db exec vitest run
.agents/skills/graft-verify/scripts/pg.sh down "$P/itest"
```

Suites that need Neon or S3 skip themselves once `offline.sh` removes the
keys. That is correct. Report them as skipped, never as passed.

Helpers:

- `scripts/offline.sh [--db <url>] <command>` runs a command with every cloud
  credential removed. Refuses to run if a repo-root `.env` exists, because
  tests load it directly.
- `scripts/mcp-call.mjs <tool> '<json args>' [...]` runs `graft mcp` in the
  current directory, sends each call, prints the results, and exits 1 if any
  call errored. `tools/list` and other method names work too.
- `scripts/pg.sh up|down <dir>` starts or stops a throwaway Postgres.
- `agent-browser` drives any web surface (`npm i -g agent-browser` once; set
  `AGENT_BROWSER_EXECUTABLE_PATH=/opt/pw-browsers/chromium` in cloud
  containers).

## Evidence

Save proof under `$P/evidence/` (or your scratchpad) and quote it verbatim in
the PR's Verification section:

- CLI: the command, stdout and stderr, and `exit=$?`.
- MCP: the `mcp-call.mjs` output for the failing call and the passing call.
- Web: a screenshot at 1440×900 and 390×844, in the theme that matters, and
  the accessibility snapshot (`agent-browser snapshot -i -c`).
- Writes: `cat` the file that changed, then a read through a second path
  (`get_content`, `graft content`, or the page).

## Cleanup

```sh
.agents/skills/graft-verify/scripts/pg.sh down "$P/pg"   # Postgres sandboxes
kill "$STUDIO_PID" "$ASTRO_PID" 2>/dev/null               # what you started
```

Leave `$P/evidence/` in place. Delete sandboxes only once the evidence is in
the PR.

## Keeping this honest

When a recipe here is wrong, fix it in the same PR as the change that
exposed it. When you add a user-facing feature, add or extend its feature
file with the four sections the others use: Sub-features, How to get to it,
Driving it, Gotchas.
