# Conventions

Foundational conventions for the Graft monorepo. Keep this short and current.

## Packages

- All packages live under `packages/*` and are named `@graft/<name>`.
- Each package: `package.json`, `tsconfig.json` (extends `../../tsconfig.base.json`),
  and a `src/` directory with `src/index.ts` as the entry point.
- Libraries build with `tsup` to `dist/` (ESM + `.d.ts`). Apps (CLI, Studio) may differ.
- Cross-package imports use the package name (`@graft/contracts`), never relative paths
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
- Errors thrown across boundaries are `GraftError` (from `@graft/contracts`) and must carry a `fix`.

## Scripts (run from the repo root)

| Command                             | What it does                   |
| ----------------------------------- | ------------------------------ |
| `pnpm build`                        | Build all packages (Turborepo) |
| `pnpm dev`                          | Watch-build all packages       |
| `pnpm test`                         | Run all package tests (Vitest) |
| `pnpm lint`                         | oxlint across packages         |
| `pnpm typecheck`                    | `tsc --noEmit` across packages |
| `pnpm format` / `pnpm format:check` | oxfmt write / check            |

## Testing

- **Unit tests** (pure logic, no network/DB) run in `pnpm test` and CI — keep them
  deterministic and fast.
- **Integration tests** (live DB / R2) are **opt-in** and skipped by default. Name them
  `*.integration.test.ts`, gate them behind `RUN_INTEGRATION=1`, and load `.env` in-file.
  Run locally with PowerShell: `$env:RUN_INTEGRATION='1'; pnpm --filter <pkg> test`.

## Git

- Default branch: `main`. Never commit directly to `main` for feature work.
- Branch naming: `preview/<short-topic>` for content/feature branches (these map to
  copy-on-write DB preview branches from Phase 4).
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- Do not commit `.env`, `dist/`, or `node_modules/`.

## Adding a package

1. Create `packages/<name>/` with `package.json` (`@graft/<name>`), `tsconfig.json`, `src/index.ts`.
2. Copy the build/test/typecheck/lint scripts from an existing package.
3. `pnpm install` to register it in the workspace.
