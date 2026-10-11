# CLI: init and compile

A developer scaffolds a project, compiles content, and reads a clear error with
a fix when a file is wrong.

## Sub-features

- `cli.init`: `graft init [dir]` writes `graft.config.ts`, `graft/index.ts`,
  `content/pages/home.mdx`, `llms.txt`, `.gitignore`.
- `cli.compile`: `graft compile` validates every file and writes the index.
- `cli.compile-error`: a bad frontmatter field stops the compile with
  `SCHEMA_VALIDATION_FAILED` and a `fix` line.
- `cli.content`: `graft content` lists the compiled tree (Postgres only today).

## How to get to it (user POV)

- A terminal in a project folder: `npx @usegraft/cli@latest init`, then
  `npx @usegraft/cli@latest compile`.
- The getting-started guide and its agent prompt.

## Driving it with the CLI

Preconditions: `REPO` and `O` from the skill's Launch step, a sandbox from `scripts/sandbox.sh`, `cd "$P"`, and
`G="node $REPO/packages/cli/dist/index.js"`.

- **Compile succeeds.** `$O $G compile; echo exit=$?`
  prints `Compiled 1 doc(s) @ no-git: +0 added, ~0 changed, -0 removed, 1 unchanged`
  (the sandbox already compiled once) and `exit=0`.
- **Compile rejects a bad field.**
  `printf -- '---\ntitle: About\ntagline: 42\n---\nHi.\n' > content/pages/about.mdx`
  then compile. Expect:
  `error SCHEMA_VALIDATION_FAILED: pages/about.mdx does not match collection "pages"`,
  a `fix:` line naming `tagline`, a `details:` JSON line, and `exit=1`.
- **The fix works.** Quote the value (`tagline: "42"`), compile again, expect
  `+1 added`.
- **Content list** (Postgres sandbox): `$O $G content` prints
  `pages/home  (Hello, Graft)  pages/home.mdx`.

## Gotchas

- `graft content` needs `DATABASE_URL` even in a static project and fails with
  `ENV_VAR_MISSING`. Its help text says it reads "the compiled index".
- Node prints `ExperimentalWarning: SQLite is an experimental feature` on
  stderr. It is not a failure.
- Without `$O`, a command that touches the database reaches whatever the
  environment's `DATABASE_URL` points at. The CLI reads the project's `.env`
  only for variables that are not already set, so a Postgres sandbox's
  `.env` applies only once `$O` has removed the environment's value.
