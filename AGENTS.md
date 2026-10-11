# Working in this repository

Instructions for any coding agent working in this repository. `CLAUDE.md`
points here.

Graft is an open-source CMS that keeps content as MDX in Git, checks it with
one Zod schema, and lets agents operate it over MCP. Read `CONTEXT.md` for the
words, `CONVENTIONS.md` before writing code, and `CONTRIBUTING.md` for what
gets turned down.

## Load the right skill first

Skills live in `.agents/skills/` (`.claude/skills` links to it).

| Before you                                  | Load                                    |
| ------------------------------------------- | --------------------------------------- |
| Start any non-trivial task                  | `graft-workflow` (it picks a playbook)  |
| Say a change works                          | `graft-verify`                          |
| Touch anything a person sees                | `graft-design`, which reads `DESIGN.md` |
| Write any words: docs, errors, commits, PRs | `graft-writing`                         |

## Facts that save you an hour

- PRs target `feat/core`, never `main`.
- Build with `pnpm -r --filter <pkg>... run build` if `pnpm build` (Turbo)
  fails with `Exec format error` in a container.
- Run tests and CLI calls through `.agents/skills/graft-verify/scripts/offline.sh`.
  A cloud session's environment can hold live keys for a real database, Neon
  project, bucket and GitHub token, and integration tests read them.
- Every published-package change needs a changeset (`pnpm changeset`).
- Every error that crosses a package boundary is a `GraftError` with a `fix`.
  After changing one, run `pnpm docs:errors`.
- `packages/registry/registry/*/graft/` and `examples/*/graft/` are copies on
  purpose. Change both; `pnpm check:registry-drift` checks them.

## Never

- Push to `main` or `feat/core`, publish, or deploy unless asked. Commits and
  pushes to your own working branch are fine.
- Delete or change anything on a real external service without the user's
  say-so.
- Silence a lint rule, skip a test, or weaken a `check:*` script to get green.
- Put a private prompt, a chat transcript or a credential in a commit, a
  changeset or a PR.

## Rules and what enforces them

When the user corrects an agent, fix the mistake and add or update a row
(see `graft-workflow/playbooks/correct.md`). A rule enforced only by this
file is a candidate to move up into a check.

| Rule                                                                                                                          | Enforced by                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Formatting matches the repo                                                                                                   | `pnpm format:check`, pre-commit hook                                                       |
| PR titles are Conventional Commits, lowercase after the colon, no period                                                      | `Conventional title` check on every PR                                                     |
| No slop patterns in TypeScript                                                                                                | `pnpm lint` (anti-slop plugin)                                                             |
| Registry copies stay in sync                                                                                                  | `pnpm check:registry-drift`                                                                |
| The error reference matches the code                                                                                          | `pnpm check:error-docs`                                                                    |
| Every docs route builds                                                                                                       | `pnpm check:site`                                                                          |
| Coverage never drops                                                                                                          | `pnpm coverage` floors                                                                     |
| New dependencies are at least three days old                                                                                  | `minimumReleaseAge` in `pnpm-workspace.yaml`                                               |
| An agent can learn Graft from MCP alone                                                                                       | `pnpm test:cold-agent`                                                                     |
| No mono labels, literal colors, undefined variables, odd font weights or `transition: all` in the docs and Studio stylesheets | `pnpm check:design`                                                                        |
| No em dashes in docs-site MDX prose, every `CodeBlock` has a title                                                            | `pnpm check:design`                                                                        |
| Tests never reach live Neon, S3 or GitHub by accident                                                                         | `RUN_LIVE=1` gate on the live suites, and `.agents/skills/graft-verify/scripts/offline.sh` |
| Visual changes are rendered before they are claimed                                                                           | This file and `graft-design` only                                                          |
