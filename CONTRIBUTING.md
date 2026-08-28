# Contributing to Graft

Thanks for wanting to help. This page covers how to get the repo running, what
has to pass before a change can land, and how to open a pull request that gets
reviewed quickly.

Engineering details live in [`CONVENTIONS.md`](CONVENTIONS.md). Read it before
your second pull request. This page is enough for your first.

## Open an issue first, unless the fix is small

Open a pull request directly for a typo, a broken link, a wrong error message,
or a failing test you can fix in a few lines. Anything larger starts as an
issue, so the design gets discussed before you spend an evening on it.

Say what you want to do and why. If the change adds a dependency, a package, or
a new public export, say that too.

### What gets turned down

Graft holds a small number of invariants. A change that breaks one is refused
no matter how well it is written:

- Git is authoritative for authored content. The index is derived. If the two
  disagree, git wins and the compiler rebuilds.
- Operational data belongs to Postgres and is reached only through typed
  functions.
- Validation is one Zod layer, shared by schema, compiler, and functions.
- Destructive operations are always human-gated, whatever the approval policy
  says.
- Errors that cross a package boundary are `GraftError` and carry a `fix` an
  agent can act on.

Graft is pre-1.0, so a breaking change is welcome when it buys a better design.
Say in the pull request what breaks and who has to change.

## Set up the repo

You need Node 22.16 or later and pnpm 11. The repo pins pnpm through
`packageManager`, so Corepack picks the right version for you.

```bash
git clone https://github.com/AndersonDesign1/graft.git
cd graft
pnpm install
pnpm build
pnpm test
```

`pnpm install` also points git at `.githooks`, which formats and lints before
each commit. To skip the hook in an emergency, commit with `--no-verify`.

On Node 22.16 and 22.17, `pnpm lint` needs type stripping turned on. Node 22.18
and later do it by default:

```bash
NODE_OPTIONS=--experimental-strip-types pnpm lint
```

Without the flag, lint fails with `ERR_UNKNOWN_FILE_EXTENSION ".ts"`, which
looks like a broken config and is not.

No database is required for any of this. Graft compiles content to a SQLite
artifact by default, and the whole unit suite runs against it.

## Find the code

| Path                                              | What lives there                                             |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `packages/contracts`                              | Error codes and the introspection types every package shares |
| `packages/core`                                   | `defineCollection`, `defineFunction`, the function runtime   |
| `packages/db`                                     | Postgres client, migrations, the static SQLite index         |
| `packages/compiler`                               | Authored MDX to a projected index, plus the ChangeSet        |
| `packages/sdk-core`                               | The typed read client every framework SDK wraps              |
| `packages/sdk-next`, `sdk-astro`, `sdk-sveltekit` | Framework adapters                                           |
| `packages/cli`                                    | `graft init`, `compile`, `serve`, `mcp`, `add`, and the rest |
| `packages/mcp`                                    | The agent surface, over stdio and Streamable HTTP            |
| `packages/studio`                                 | The optional human editor and approval queue                 |
| `packages/registry`                               | Owned primitives that `graft add` copies into a project      |
| `examples/docs-site`                              | The documentation site, which runs on Graft                  |
| `examples/landing-page`                           | The commerce and functions demo                              |
| `docs/adr`                                        | Decisions that are settled, with the premise each rests on   |

Cross-package imports use the package name, never a relative path across a
package boundary.

## Run the checks

CI runs each of these. Run them locally first.

| Command                     | What it checks                                                  |
| --------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`         | oxfmt formatting                                                |
| `pnpm lint`                 | oxlint, including the vendored anti-slop rules                  |
| `pnpm check:registry-drift` | A registry primitive and its copy in the example still match    |
| `pnpm typecheck`            | `tsc --noEmit` across the workspace                             |
| `pnpm build`                | Every package and example builds                                |
| `pnpm test`                 | The unit suite                                                  |
| `pnpm test:cold-agent`      | An agent reaching Graft only through MCP can still teach itself |
| `pnpm test:quickstart`      | An empty directory reaches typed reads with no database         |

Never silence a lint rule to get a green run. Either fix the finding, or change
the setting in `.oxlintrc.json` and write down why in `CONVENTIONS.md`.

### Integration tests

Tests that need a live database or object store are opt-in and skipped by
default. Name them `*.integration.test.ts` and gate them behind
`RUN_INTEGRATION=1`.

```bash
RUN_INTEGRATION=1 DATABASE_URL=postgres://... pnpm test
```

`RUN_INTEGRATION` is declared in `turbo.json`. A variable that is not declared
there is deleted before the task runs rather than merely uncached, so an
undeclared flag silently does nothing.

### Coverage

`pnpm coverage` enforces a per-package floor from
`scripts/coverage-floors.json`. The floors only go up. If your change earns a
higher floor, raise it in the same pull request.

## Adding a dependency

New dependency versions must be at least three days old. The gate is
`minimumReleaseAge` in `pnpm-workspace.yaml`, and it exists to keep a
compromised release from reaching the lockfile on the day it ships.

If you need a package that is exempt, add it to `minimumReleaseAgeExclude` and
say in the pull request why the risk is acceptable.

## Describe the change for the release

Every change to a published package needs a changeset. Run:

```bash
pnpm changeset
```

Pick the packages you touched and the bump level, then write one or two
sentences a user of the package would understand. All `@usegraft/*` packages
version together, so the level you pick moves every one of them.

Skip the changeset for a change that touches only docs, tests, or CI.

## Open the pull request

Target `feat/core`. It is the default branch and the working mainline until
1.0.

Use [Conventional Commits](https://www.conventionalcommits.org) for the commit
messages and the pull request title:

```
feat(compiler): index asset references from frontmatter
fix(mcp): refuse anonymous callers on the HTTP mount
docs(security): state what a stolen runtime credential can reach
```

In the pull request body, say:

- What changed, and what problem it solves.
- Which invariant it touches, if any.
- What breaks, if anything, and what a user has to do about it.
- How you tested it. Name the command.

A pull request that adds behaviour without a test is not ready. A pull request
that changes an error message without changing its `fix` usually is not either.

## Contributing to the docs

The documentation site is `examples/docs-site`, and it runs on Graft. Pages are
MDX under `examples/docs-site/content/docs/`.

```bash
pnpm --filter docs-site compile   # authored MDX to the content index
pnpm --filter docs-site dev
```

Docs follow [Diátaxis](https://diataxis.fr): one page, one mode. A tutorial
teaches, a how-to solves a problem, a reference page describes and nothing
more, and an explanation argues. Do not mix them on one page. Split and link
instead.

Write real symbol, file, and command names. Not a description of them.

## Reporting a vulnerability

Do not open a public issue for anything exploitable. Follow
[`SECURITY.md`](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report
unacceptable behaviour to josanderson25@gmail.com.
