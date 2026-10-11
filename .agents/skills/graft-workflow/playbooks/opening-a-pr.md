# Opening a PR

Every playbook ends here.

1. **Branch.** Work on your assigned branch. PRs target `feat/core`, never
   `main` (`CONTRIBUTING.md`).
2. **Checks**, all of them, before pushing:
   `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, the tests of every
   package you touched, and the `check:*` scripts that cover what you
   changed (`check:registry-drift`, `check:error-docs`, `check:site`,
   `check:changelog`). Run tests through `graft-verify`'s `offline.sh`.
3. **Commits.** Small and ordered so each could land alone, in the
   `graft-writing` commit style. A failing test lands before its fix.
4. **Changeset** for every published package you changed (`pnpm changeset`).
   None for docs, tests or CI only.
5. **Self-review the diff** as a reviewer would: dead code, debug output,
   comments that narrate instead of explaining a non-obvious why, anything
   private.
6. **PR body** follows `.github/PULL_REQUEST_TEMPLATE.md` (What changed,
   Why, Breaking?, How you tested it, Checklist), written per
   `graft-writing/references/commits-and-prs.md`. "How you tested it" holds
   real commands and their real output.
7. **Smaller is better.** Prefer three focused PRs to one large one. A
   stack targets its parent branch.
8. Open it ready for review, not as a draft, unless the user asked for a
   draft.

**Reply:** the PR link, what it changes for users, and its verification.
