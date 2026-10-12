---
"@usegraft/db": minor
"@usegraft/compiler": minor
"@usegraft/cli": minor
"@usegraft/mcp": minor
"@usegraft/studio": minor
---

Moving content between the database, your files and git.

- `graft pull` writes what is published into your files, and `graft push`
  publishes the files you changed. Graft remembers what each file was pulled
  at (`.graft/sync.json`), so a pull never overwrites your changes, and a push
  is refused with `CONTENT_CONFLICT` if someone published that document since.
  `--force` settles a conflict either way.
- `graft dev` tells you when someone publishes, so you know your files are
  behind. Agents get the same answer from the new MCP tool `sync_status`.
- `content.mirror` copies what is published into GitHub: in batches from
  `graft serve` (`mode: "batch"`, every `everyMinutes`), or after every publish
  (`mode: "each"`). `graft mirror` does one run. A batch is one commit, or one
  pull request merged straight away when the branch allows it. A pull request
  that waits on checks or a review stays the only one: later runs add to it
  until it merges.
- `graft check` runs every check a publish makes on the files, with no
  database, and now also finds references to documents that don't exist.
- `graft ci changes`, `graft ci skip-build` and `graft ci init` keep CI cheap
  on content-only changes. `skip-build` compares with the previous deploy, and
  builds when it can't tell which that was.

For git-sourced projects hosted on GitHub, some publishes now open a pull
request even for an editor: deletions and renames, and changes over 200 lines.
Studio says why. Change the rule with `content.review` (`deletes`,
`collections`, `overLines`), or turn it off with `review: false`.

`graft db migrate` adds the `content_mirror` table.
