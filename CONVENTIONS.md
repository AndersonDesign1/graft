# Conventions

Foundational conventions for the Graft monorepo. Keep this short and current.

## Packages

- All packages live under `packages/*` and are named `@usegraft/<name>`.
- Each package: `package.json`, `tsconfig.json` (extends `../../tsconfig.base.json`),
  and a `src/` directory with `src/index.ts` as the entry point.
- Libraries build with `tsup` to `dist/` (ESM + `.d.ts`). Apps (CLI, Studio) may differ.
- Cross-package imports use the package name (`@usegraft/contracts`), never relative paths
  across package boundaries.

## Source of truth (invariants)

- **Git is authoritative for authored content.** Postgres is a derived index; if they
  disagree, git wins and the compiler rebuilds.
- **Operational data** (orders, accounts, progress) is owned by Postgres, accessed only
  through typed functions.
- Validation is **one Zod layer** shared across schema, compiler, and functions.
- **Destructive operations are always human-gated**, regardless of approval policy.

## TypeScript

- **TypeScript 7** (native Go `tsc`) for typechecking. Dual install until tooling catches up:
  - `@typescript/native` → `typescript@^7` (CLI `tsc` for `pnpm typecheck`)
  - `typescript` → `@typescript/typescript6` (JS API for tsup DTS / programmatic consumers)
  - Drop the dual install when tsup (and peers) support the TS 7 API (expected ~7.1 era).
- `strict` everywhere (see `tsconfig.base.json`). Target ES2022, ESM, `moduleResolution: Bundler`.
- Prefer explicit return types on exported functions.
- Errors thrown across boundaries are `GraftError` (from `@usegraft/contracts`) and must carry a `fix`.

## Scripts (run from the repo root)

| Command                             | What it does                                  |
| ----------------------------------- | --------------------------------------------- |
| `pnpm build`                        | Build all packages (Turborepo)                |
| `pnpm dev`                          | Watch-build all packages                      |
| `pnpm test`                         | Run all package tests (Vitest)                |
| `pnpm lint`                         | oxlint across packages                        |
| `pnpm typecheck`                    | `tsc --noEmit` across packages                |
| `pnpm format` / `pnpm format:check` | oxfmt write / check                           |
| `pnpm changeset`                    | Describe a change for the next release        |
| `pnpm check:canary-snapshot`        | Guard: refuse a canary that is not a snapshot |

## Lint calibration

`pnpm lint` runs `oxlint` **once from the repo root**, so `.oxlintrc.json` is the only
lint config that applies. (Running `oxlint .` inside a package silently uses oxlint's
defaults and ignores this file — do not add per-package lint scripts.)

On top of oxlint's defaults we vendor the [anti-slop](https://github.com/dmmulroy/anti-slop)
plugin at `tools/oxlint/anti-slop/`. Its 15 rules are calibrated rather than switched on
wholesale, because three of them contradict what this codebase does for a living:

| Rule                                                                                        | Setting | Why                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-unsafe-dictionary-type`                                                                 | off     | `Record<string, unknown>` is the correct type for a JSONB column and for authored frontmatter. The shape is per-collection and enforced by Zod at the boundary, not by the column type.                         |
| `no-runtime-typeof`                                                                         | off     | The rule says "parse at the I/O boundary and branch on the domain value". Our `typeof` checks _are_ the boundary parse — reading a JWT claim that may be a string or an array, or sniffing untyped frontmatter. |
| `no-unknown-parameters`                                                                     | off     | `catch (e: unknown)` is correct TypeScript, and our error helpers take `unknown` by design.                                                                                                                     |
| `require-safety-comment-for-type-assertion`                                                 | warn    | 378 assertions is a real signal worth watching, but a `SAFETY:` comment on each is churn, not safety. Ratchet the count down; do not bulk-annotate.                                                             |
| `no-conditional-empty-object-spread`, `no-known-value-widening`, `no-shape-in-symbol-names` | warn    | Style, not correctness.                                                                                                                                                                                         |
| everything else                                                                             | error   | These catch real defects: chained assertions that lie to the type checker, and module mocking that stubs out the thing under test.                                                                              |

The plugin is TypeScript, and oxlint loads it through Node's ESM loader. Node
strips types by default from **22.18**; the repo's floor is 22.16 (node:sqlite
bundles FTS5 from there), so on 22.16–22.17 `pnpm lint` needs
`NODE_OPTIONS=--experimental-strip-types`. CI sets it. The symptom without it is
`ERR_UNKNOWN_FILE_EXTENSION ".ts"`, which reads like a config error and is not.

Never silence a rule to get a green run. Either fix the finding, or change the setting
here and write down why.

## Testing

- **Unit tests** (pure logic, no network/DB) run in `pnpm test` and CI — keep them
  deterministic and fast.
- **Integration tests** (live DB / R2) are **opt-in** and skipped by default. Name them
  `*.integration.test.ts`, gate them behind `RUN_INTEGRATION=1`, and load `.env` in-file.
  Run locally with PowerShell: `$env:RUN_INTEGRATION='1'; pnpm --filter <pkg> test`.

## Git

- `main` is the default branch and the public face of the repository. It is merged
  from `feat/core` at each release, and nothing lands on it directly.
- `feat/core` is the working mainline. Every change lands there, and it is the only
  branch that publishes to npm.
- Feature branches are cut from `feat/core` and merge back into it.
- Branch naming: `preview/<short-topic>` for content/feature branches (these map to
  copy-on-write DB preview branches from Phase 4).
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Do not commit `.env`, `dist/`, or `node_modules/`.

## Releasing

Two channels. Both publish from `.github/workflows/release.yml`, because npm
trusted publishing registers **one** workflow filename per package and a second
workflow would authenticate against nothing.

### Stable, to `latest`

`changesets/action` runs on push to `feat/core`. It opens a
"chore: version packages" PR, and **merging that PR publishes**. Both gates
belong to the repository owner.

All packages bump together: `.changeset/config.json` sets
`fixed: [["@usegraft/*"]]`, so every package versions whether it changed or not.

```bash
pnpm changeset          # describe a change
pnpm changeset status   # what the next release would bump
```

CI on the version PR shows `action_required` and does not run, because GitHub
holds workflows on PRs the changesets bot opens. Approve it, or rely on CI
having passed on `feat/core` for the identical code.

### Canary, to the `canary` tag

Snapshot releases: `0.0.0-canary-<timestamp>`, published under the `canary`
dist-tag. `latest` never moves and real version numbers never change. There is
no canary branch and none is needed.

1. Branch off `feat/core`, build the change.
2. `pnpm changeset`. **Required** — with nothing pending there is nothing to
   snapshot and the run is refused.
3. Push the branch.
4. Actions → Release → Run workflow → select **your branch** → tick
   "Publish a snapshot to the canary dist-tag".
5. `npm i @usegraft/cli@canary`

The tick resets every dispatch. Unticked is the safe default: a normal release,
which is an idempotent no-op when nothing is pending.

Never commit a snapshot bump. `changeset version --snapshot` consumes the
changeset files as it runs, so committing it would drop the pending changesets
for the real release.

`scripts/assert-canary-snapshot.mjs` runs between versioning and publishing
because `changeset version --snapshot` does not fail when nothing is pending —
it warns and exits 0, and the publish would then push a **stable** version to
the canary tag. Run it locally with `pnpm check:canary-snapshot`.

## Adding a package

1. Create `packages/<name>/` with `package.json` (`@usegraft/<name>`), `tsconfig.json`, `src/index.ts`.
2. Copy the build/test/typecheck/lint scripts from an existing package.
3. `pnpm install` to register it in the workspace.
4. **Publish it once by hand, before CI ever tries.** OIDC trusted publishing
   needs the package to already exist on npm — there is nothing to hold the
   trusted-publisher config on until then, so the first release fails with E404
   while everything that depends on it publishes fine.

   ```bash
   npm login
   pnpm --filter @usegraft/<name> publish --access public --no-git-checks
   ```

   `pnpm`, never `npm`: `npm publish` leaves `workspace:*` in the manifest,
   which npm cannot resolve. pnpm rewrites it to the real version.

5. Add its trusted publisher on npmjs.com (GitHub Actions,
   `AndersonDesign1/graft`, `release.yml`) so it releases with everything else
   from then on.

Skipping 4 and 5 is what left `npm i @usegraft/cli` broken after the `0.2.0`
release: 15 packages published, `@usegraft/mdx-safety` did not, and five of the
15 depended on it.
