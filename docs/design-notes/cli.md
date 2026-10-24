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

About a third of `graft check` is still module loading, and another third is
parsing MDX with micromark. Bundling the MDX parser into the CLI is the next
thing to measure.

## Left out on purpose

- **No built-in JSON filter.** `jq` already does it, and a second query
  language is one more thing to learn.
- **No automatic JSON when stdout is not a terminal.** CI logs are read by
  people. A program asks for JSON with `--json`.
- **No secrets as flag values.** They end up in shell history and in `ps`. A
  test refuses any flag whose name looks like a token, secret, password or key.
