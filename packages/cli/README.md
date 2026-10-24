# @usegraft/cli

> The `graft` command. Scaffold a project, compile authored content, serve the runtime, split your database credentials.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i -D @usegraft/cli
# or run it without installing
npx @usegraft/cli@latest init
```

Once installed, the command is `graft`. Run it without installing under the
full package name: the bare name `graft` on npm belongs to an unrelated
package, so `npx graft` fetches the wrong thing.

## Quickstart, with no database

A content project needs no services at all. `graft compile` writes the index to a SQLite artifact your app reads embedded.

```bash
npx @usegraft/cli@latest init      # scaffolds graft.config.ts, content/, llms.txt
npx @usegraft/cli@latest compile   # → .graft/index.db
```

Move to Postgres by setting `DATABASE_URL` and changing one line in `graft.config.ts`:

```ts
export const index = "postgres";
```

## Commands

<!-- graft:commands:start -->

| Command                   | What it does                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- |
| `graft create`            | Make a new site with a template, a database, Studio and a Next.js app        |
| `graft init`              | Add Graft to a folder: graft.config.ts, content/ and llms.txt                |
| `graft doctor`            | Check the setup and print the one thing to do next                           |
| `graft add`               | Copy a ready-made primitive and its dependencies into graft/                 |
| `graft compile`           | Check every content file and build the index, once                           |
| `graft dev`               | Watch content/ and graft.config.ts, and compile on every change              |
| `graft check`             | Check every content file: schema, slugs, MDX safety and references           |
| `graft content`           | List every document; the same as graft content list                          |
| `graft content list`      | List the documents in one collection, or in all of them                      |
| `graft content get`       | Print one document as an MDX file                                            |
| `graft content search`    | Search the content by words and phrases                                      |
| `graft content write`     | Create or replace a document, checked against the schema                     |
| `graft content set`       | Set one field on many documents                                              |
| `graft content delete`    | Delete a document, once a person approves it                                 |
| `graft compilations`      | List recent compiles and what each one changed                               |
| `graft asset put`         | Upload a file to the asset store and print the frontmatter that points to it |
| `graft drafts`            | List unpublished drafts, for content kept in the database                    |
| `graft drafts publish`    | Publish drafts, or ask for a review                                          |
| `graft drafts discard`    | Throw away drafts, back to the published version                             |
| `graft schema`            | Print each collection's fields, and the typed functions                      |
| `graft fn`                | List the typed functions                                                     |
| `graft fn describe`       | Print one function's input schema and access rules                           |
| `graft fn run`            | Run a typed function with a JSON input                                       |
| `graft explain`           | Explain an error code: what it means and how to recover                      |
| `graft mcp tools`         | List the MCP tools an agent sees for this project                            |
| `graft mcp call`          | Call any MCP tool by name, as an agent would                                 |
| `graft mcp`               | Serve the project to an agent on this computer over stdio (MCP)              |
| `graft serve`             | Run Graft over HTTP: functions, MCP, the Content API and /healthz            |
| `graft studio`            | Open Studio, the editor, on this computer                                    |
| `graft studio invite`     | Print a sign-in link for a hosted Studio                                     |
| `graft studio setup-code` | Print the code a hosted Studio asks for on its first visit                   |
| `graft content import`    | Load the content files into the database, for a database-sourced project     |
| `graft pull`              | Write what is published into your files                                      |
| `graft push`              | Publish the files you changed since your last pull                           |
| `graft mirror`            | Commit what was published since the last run to GitHub                       |
| `graft db migrate`        | Create or update the tables Graft needs; safe to run again                   |
| `graft db claim`          | Keep the free database graft create made                                     |
| `graft migrate`           | Run your own content and data migrations                                     |
| `graft harden`            | Give a database role the limited rights a deployed app needs                 |
| `graft approvals`         | List actions waiting for a person to approve them                            |
| `graft approve`           | Approve an action; the caller then repeats its call with the id              |
| `graft deny`              | Deny an action                                                               |
| `graft branch`            | List branches                                                                |
| `graft branch create`     | Create a preview branch                                                      |
| `graft branch drop`       | Delete a branch: purge an overlay's rows, or delete a Neon fork              |
| `graft merge`             | Merge a branch: replay its migrations, move its data, recompile              |
| `graft ci changes`        | Print content-only=true when only content changed                            |
| `graft ci skip-build`     | Exit 0 when a deploy can be skipped                                          |
| `graft ci init`           | Write a workflow that runs graft check on content changes                    |
| `graft help`              | Show help for a command or a topic                                           |
| `graft commands`          | List every command; --json describes each one and its flags                  |

<!-- graft:commands:end -->

Run `graft <command> --help` for a command's flags, or `graft commands --json` for
all of them as data. The [CLI reference](https://graft.page/docs/cli-reference) has
the same table with every flag.

## Two credentials

`graft harden` splits the operator credential from the runtime one. The runtime can serve, project content, and request approvals. It can never decide one, and Postgres enforces that rather than the application.

```bash
graft harden graft_runtime
# deploy with the runtime role's URL as DATABASE_URL
# keep the operator URL for compile, migrate, merge and approve
```

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/cli/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/main/SECURITY.md)
