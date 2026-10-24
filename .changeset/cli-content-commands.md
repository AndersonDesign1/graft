---
"@usegraft/cli": minor
"@usegraft/mcp": minor
---

Read and write content from the terminal. The new commands run the same MCP
tools an agent calls, in the CLI's own process, so they check the schema,
compile, and file approvals exactly as the agent's call would. With `--json`,
each prints exactly what the tool returns.

| Command                                                    | Tool                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `graft content list [collection]`                          | `list_collections`, `list_content`                    |
| `graft content get <collection>/<slug>`                    | `get_content`, printed as the MDX file                |
| `graft content search <query>`                             | `search_content`                                      |
| `graft content write <collection>/<slug>`                  | `write_content`, from `--file` or `--data`            |
| `graft content set <collection> <slug...> --field --value` | `write_content` for each document                     |
| `graft content delete <collection>/<slug>`                 | `delete_content`                                      |
| `graft drafts`, `drafts publish`, `drafts discard`         | `list_drafts`, `publish_drafts`, `discard_drafts`     |
| `graft schema`                                             | `describe_schema`                                     |
| `graft fn`, `fn describe`, `fn run`                        | `list_functions`, `describe_function`, `run_function` |
| `graft explain <code>`                                     | `explain_error`                                       |
| `graft mcp tools`, `graft mcp call <tool>`                 | any tool, by name                                     |

`graft content get pages/home > home.mdx` and
`graft content write pages/home --file home.mdx` round-trip a document. A
delete, or a destructive function, exits 3 and its `fix` names the exact
command to repeat with `--approval <id>` once a person has approved it.

**BREAKING:** `graft content` now lists the documents from the content files
(or from the database, where content is kept there) instead of reading the
Postgres index. It works on the static engine with no `DATABASE_URL`, and
`--json` prints `{ branch, collections: [{ collection, documents }] }`.

`@usegraft/mcp` exports the client the CLI uses: `connectInProcess(server)`
and `connectClient(transport)` return a `ToolClient` that calls tools by name
and rejects with the GraftError a tool failed with
(`toolResultToGraftError`).
