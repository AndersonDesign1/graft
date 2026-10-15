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
- `cli.sync`: in a database-sourced project, `graft pull`, `graft push` and
  `graft mirror` move content between Postgres, the files and GitHub.
- `cli.check`: `graft check` validates the files with no database.
- `cli.create`: `graft create [dir]` (what `npm create graft` runs) writes a
  site from a template, makes or connects a database, installs, migrates and
  loads example content.
- `cli.doctor`: `graft doctor` prints the setup checklist and the next step;
  MCP `setup_status` returns the same.

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

- **Pull and push** (database-sourced sandbox, see `studio.md`): `$O --db "$URL" $G pull`
  lists the files it updated. Edit one, `$O --db "$URL" $G push` prints
  `Published 1 file(s)`. Publish the same document over MCP
  (`GRAFT_DEV_SCOPES=content:publish`, `write_content` then `publish_drafts`),
  edit the file again, and push: `error CONTENT_CONFLICT` and nothing is written.
  `graft pull` then lists it under "changed both here and in the database".
- **Mirror** without a real repository: serve the in-memory GitHub with a
  script that calls `createGitHubFake().listen(0)` from
  `packages/compiler/dist/testing.js`, then run
  `$O --db "$URL" env GRAFT_GITHUB_REPO=acme/site GRAFT_GITHUB_TOKEN=test-token GRAFT_GITHUB_API_URL=<printed url> $G mirror`.
  A second run prints "Git already has everything that is published."

- **Create, then build the Next.js site.** Inside the repo (so `@usegraft/*`
  resolve), `$O $G create packages/cli/.test-tmp/blog --template blog
  --framework next --edit code --database none --no-install` prints
  `✓ Wrote a blog site with Next.js`. Link
  `packages/sdk-next/compat/next16/node_modules` into it as `node_modules`
  (copy `packages/sdk-next/dist` over the injected copy first, as
  `compat/smoke.mjs` does), run `$G compile`, then `node_modules/.bin/next
  build` and `next start -p 3217`. `/` lists "Hello, world" above "How we
  work", and `/posts/hello-world` renders its body.
- **Online editing goes live.** `create` with `--edit online --database
  "$URL" --no-install` against an empty scratch database, then `content
  import`, `doctor` (all pass except the Studio sign-in warning), `next
  start`, and `graft studio`. Save and publish an entry over the Studio API;
  the next request to the site shows it.
- **Never run `--database new` in a test.** It makes a real database on an
  outside service. The unit tests fake that service's answers.

## Gotchas

- Anything `graft mcp` prints to stdout breaks the protocol stream, including a
  log line from a hook. Log to stderr.

- `graft content` needs `DATABASE_URL` even in a static project and fails with
  `ENV_VAR_MISSING`. Its help text says it reads "the compiled index".
- Node prints `ExperimentalWarning: SQLite is an experimental feature` on
  stderr. It is not a failure.
- Without `$O`, a command that touches the database reaches whatever the
  environment's `DATABASE_URL` points at. The CLI reads the project's `.env`
  only for variables that are not already set, so a Postgres sandbox's
  `.env` applies only once `$O` has removed the environment's value.
