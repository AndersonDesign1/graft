# The graft CLI as a program's interface

The CLI is read by people and by programs: deploy scripts, CI jobs, and
agents that run shell commands. This note records the rules every command
follows so both kinds of reader can rely on it, and why.

## One table of commands

Every command, argument and flag is declared once, in
`packages/cli/src/registry.ts`. Four things read it:

| Reader                                   | What it gets                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- |
| The argument parser (`args.ts`)          | The flags a command accepts; anything else is a usage error          |
| `graft --help`, `graft help` (`help.ts`) | Usage lines, generated from the declared arguments and flags         |
| `graft commands --json`                  | The whole table as data, for an agent learning the CLI in one call   |
| `scripts/gen-cli-docs.mjs`               | The CLI reference page and the README's command table, checked in CI |

Before this, help lived in three hand-kept places (the root help, the
per-command help, the docs page) that disagreed in a dozen spots, and the
parser accepted every flag for every command. `graft init --apply` succeeded
and did nothing, which is how a dry run gets mistaken for a real one.

The registry is data only, and a test holds it to that: `graft --help` loads it
and nothing else. The code each command runs is in `handlers.ts`, keyed by the
command's id, and is imported only when a command runs.

## Output

- Data goes to stdout, everything else to stderr.
- A command that prints data takes `--json` and prints exactly one JSON object.
  While it runs, stdout points at stderr, so a stray `console.log` in a config
  file or a Postgres notice cannot corrupt the object.
- The object is indented on a terminal and on one line when piped.
- Commands that run until stopped (`dev`, `serve`, `studio`, `mcp`) take no
  `--json`; asking for it is a usage error.

## Errors and exit codes

Every failure has a code and a `fix`, the same shape as a GraftError over MCP.
Under `--json` it is one JSON line on stderr (`GraftErrorJSON`). Usage
mistakes are `USAGE_INVALID`; an error the CLI does not recognize is
`INTERNAL_ERROR`, with the stack behind `GRAFT_DEBUG=1`.

| Exit code | Meaning                                      | Why it is separate                                 |
| --------- | -------------------------------------------- | -------------------------------------------------- |
| 0         | It worked                                    |                                                    |
| 1         | It failed                                    |                                                    |
| 2         | Called wrong; nothing ran                    | Retrying unchanged fails the same way              |
| 3         | A person must approve first                  | The caller waits for `graft approve`, then repeats |
| 4         | Credential missing, wrong or short of access | Retrying needs a different credential              |

A program decides what to do next from the exit code alone, without parsing
the message. GraftErrors are recognized by shape rather than `instanceof`, so
printing an error never loads Zod and a second copy of `@usegraft/contracts`
cannot defeat the check.

## Questions and color

Only `create` and `db claim` ask questions, and only on a terminal.
`--no-input` or `GRAFT_PROMPT_DISABLED` turns questions off, and the command
says which flag answers the question instead. Color follows `NO_COLOR`,
`FORCE_COLOR`, `CLICOLOR`, `CLICOLOR_FORCE` and `TERM=dumb`.

## Speed

`--help`, `--version` and a usage error load the registry, the help renderer
and nothing else. `src/index.ts` turns on Node's compile cache before loading
the CLI. Measured on `examples/docs-site`, interleaved runs, same build: `graft
check` went from 1644 ms to 1519 ms with the cache, and `--help` from 43 ms to
41 ms.

Two later changes took most of what was left, measured the same way on
`examples/docs-site` (medians of 8 interleaved runs):

- **Static commands never load the Postgres code.** drizzle-orm and its
  Postgres module took about 370 ms to load, and every package that touched
  `@usegraft/db` loaded them at import, static project or not. The static
  engine now imports `@usegraft/db/static`, which has no drizzle behind it,
  and core, the compiler and the MCP server load the root entry inside the
  functions that talk to Postgres. `graft content get` went from 951 ms to
  481 ms. `src/static-startup.test.ts` runs the built CLI under a resolve
  hook and fails if a static command loads drizzle-orm or the driver again.
- **The safety scan is cached for unchanged bodies.** Checking each body for
  executable MDX is a full parse with remark-gfm and remark-mdx, about 750 ms
  of the docs site's check. `graft check` and `graft compile` keep the result
  per body under `$XDG_CACHE_HOME/graft/mdx-safety`, keyed on the sha256 of
  the body and on the version of every package the scanner runs, down its
  whole dependency tree. The
  cache lives outside the project, so it is never committed. Studio saves and
  MCP writes never use it, and `MdxBody` still refuses executable bodies at
  render. A repeat `graft check` went from 1656 ms to 302 ms; one with an empty
  cache takes about 1260 ms.

## Content commands are the MCP tools

`graft content`, `graft schema`, `graft drafts`, `graft fn` and `graft mcp call`
run the project's MCP tools by name, through `ToolClient` from
`@usegraft/mcp`, rather than calling the compiler themselves. In this folder
the server runs in the CLI's own process (`project-mcp.ts`, which `graft mcp`
also uses); with `--remote` it is the hosted site's `/api/mcp`. Either way
the command and the agent's tool cannot disagree: same validation, scopes,
compile and approval gate, and `--json` is the tool's answer verbatim.

## A hosted site

- **Choosing the site.** `--local` wins, then `--remote`, then `GRAFT_URL`
  alone, else the folder's project. `GRAFT_URL` and `GRAFT_TOKEN` come from the
  real environment only, never `.env`. There is no file that binds a folder to
  a site: a folder silently pointed at production is how a write lands where
  nobody meant it to.
- **Tokens.** `graft login` takes a Studio agent token from stdin or a prompt
  that does not echo, checks it against `/api/studio/v1/workspace`, and saves
  it in `hosts.json` (directory 0700, file 0600, written whole and renamed).
  Output shows a token by its first characters only. No keychain dependency.
- **The human gate holds.** No agent token carries `approvals:decide`, so a
  remote delete exits 3 and a person approves it on the site.
- **`graft api`** reaches `/api/studio/v1`, `/api/fn` and `/api/content/v1` on
  the logged-in site only: no other origin, no `..`, no redirects followed,
  and never `/api/mcp`, which `graft mcp call` speaks properly.

## Left out on purpose

- **No built-in JSON filter.** `jq` already does it, and a second query
  language is one more thing to learn.
- **No automatic JSON when stdout is not a terminal.** CI logs are read by
  people. A program asks for JSON with `--json`.
- **No secrets as flag values.** They end up in shell history and in `ps`. A
  test refuses any flag that takes a value and whose name looks like a token,
  secret, password or key.
- **No browser login yet.** A person's own token, with their role's scopes,
  would need a Studio route that issues one. Agent tokens cover scripts and CI
  today.
