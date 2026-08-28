# @usegraft/cli

> The `graft` command. Scaffold a project, compile authored content, serve the runtime, split your database credentials.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i -D @usegraft/cli
# or run it without installing
npx @usegraft/cli init
```

Once installed, the command is `graft`. Run it without installing under the
full package name: the bare name `graft` on npm belongs to an unrelated
package, so `npx graft` fetches the wrong thing.

## Quickstart, with no database

A content project needs no services at all. `graft compile` writes the index to a SQLite artifact your app reads embedded.

```bash
npx @usegraft/cli init      # scaffolds graft.config.ts, content/, llms.txt
npx @usegraft/cli compile   # → .graft/index.db
```

Move to Postgres by setting `DATABASE_URL` and changing one line in `graft.config.ts`:

```ts
export const index = "postgres";
```

## Commands

| Command                        | Does                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `graft init`                   | Scaffold a project                                                                             |
| `graft compile`                | Validate authored MDX and project it into the index                                            |
| `graft dev`                    | Recompile on save                                                                              |
| `graft serve`                  | Run the headless runtime: typed functions, MCP over HTTP, `/healthz`                           |
| `graft studio`                 | Open the optional editing UI                                                                   |
| `graft mcp`                    | Serve MCP on stdio, for `.mcp.json`                                                            |
| `graft add <item>`             | Copy a registry primitive into your repo, shadcn-style                                         |
| `graft approve <id>`           | Decide a pending approval. Operator credential only                                            |
| `graft harden <role>`          | Grant a Postgres role exactly what a deployment needs, and nothing that can decide an approval |
| `graft branch` / `graft merge` | Copy-on-write content branches                                                                 |
| `graft migrate`                | Run content codemods when the schema changes                                                   |

Run `graft <command> --help` for flags.

## Two credentials

`graft harden` splits the operator credential from the runtime one. The runtime can serve, project content, and request approvals. It can never decide one, and Postgres enforces that rather than the application.

```bash
graft harden graft_runtime
# deploy with the runtime role's URL as DATABASE_URL
# keep the operator URL for compile, migrate, merge and approve
```

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/cli/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/main/SECURITY.md)
