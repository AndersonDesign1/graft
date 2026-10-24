---
"@usegraft/cli": minor
"@usegraft/contracts": minor
"@usegraft/mcp": patch
---

**BREAKING:** `graft` exits with a code that says what kind of failure it was,
and refuses a flag the command does not take.

Before, every failure exited 1, and a flag meant for another command was
silently ignored: `graft init --apply` succeeded and did nothing, which is how
a dry run gets mistaken for a real one. Now:

| Exit code | Meaning                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------- |
| 0         | It worked                                                                                          |
| 1         | It failed; the error says why and what to do                                                       |
| 2         | The command was called wrong: an unknown command or flag, or a missing argument. Nothing ran       |
| 3         | A person has to approve the action first (`DESTRUCTIVE_OP_REQUIRES_APPROVAL`)                      |
| 4         | The credential is missing, wrong, or lacks the access this needs (`UNAUTHORIZED`, `TOKEN_INVALID`) |

A script that checks for exit code 1 after a usage mistake must check for 2.
An unknown command no longer prints the whole help on stdout; it prints the
closest command on stderr:

```text
graft: unknown command "complie".
Did you mean `graft compile`? Run `graft --help` to list the commands.
```

Every command that prints data now takes `--json`: `init`, `doctor`, `add`,
`compile`, `check`, `content`, `compilations`, `asset put`, `studio invite`,
`content import`, `pull`, `push`, `mirror`, `db migrate`, `migrate`,
`harden`, `approvals`, `approve`, `deny`, `branch`, `branch create`,
`branch drop`, `merge`, `ci changes` and `ci skip-build`. It prints one JSON
object on stdout and sends every message to stderr. The object is indented on
a terminal and on one line when piped, so `graft doctor --json` piped to a
file is now one line. A command run with `--json` that fails prints one line
of JSON on stderr: `{"error", "message", "fix", "details"}`, the shape every
Graft error has. `graft check --json` lists each problem with its code and
fix.

Also new:

- `graft help <command>` and `graft help <topic>` (`exit-codes`, `json`,
  `environment`).
- `graft commands --json` describes every command, its arguments and flags,
  so an agent can learn the CLI in one call.
- `graft add` with no item lists the primitives you can add, instead of
  failing with `REGISTRY_ITEM_NOT_FOUND`. `graft db --help`, `graft ci --help`
  and the other families print help for every member.
- `--no-input` on `graft create` and `graft db claim`, or
  `GRAFT_PROMPT_DISABLED=1` for every command, never asks a question.
- Color follows `NO_COLOR`, `FORCE_COLOR`, `CLICOLOR`, `CLICOLOR_FORCE` and
  `TERM=dumb`.
- An unexpected error prints one line instead of a stack trace;
  `GRAFT_DEBUG=1` prints the trace.
- The CLI turns on Node's compile cache, which makes `graft check` about 8%
  faster on a 48-document project.

Two error codes are added for these, with entries in the error reference and
in `explain_error`: `USAGE_INVALID` and `INTERNAL_ERROR`.
