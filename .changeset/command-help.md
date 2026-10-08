---
"@usegraft/cli": patch
---

`graft <command> --help` prints that command's usage and exits 0.

Before, `--help` or `-h` after a command name failed with
`unknown option "--help"`. Every command now has its own usage block: the
usage line, what it does, and only the flags it reads. Help is answered before
the other arguments are parsed, so `graft merge --into --help` still prints the
merge usage. An unknown command with `--help` still reports the unknown command.
