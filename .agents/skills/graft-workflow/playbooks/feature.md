# Feature

You own the design. Decide it before you write it.

1. **Check the invariants.** Read `CONTRIBUTING.md` "What gets turned down".
   If the feature would break one (git is authoritative, operational data
   lives in Postgres behind typed functions, one Zod layer, destructive work
   is human-gated, errors that cross a package boundary carry a `fix`), stop
   and raise it.
2. **Map the area.** Trace the subsystem the feature touches, and find the
   nearest existing feature built the same way. Copy its shape.
3. **Name the data shape** and the structure that holds it, and write down
   the caller's code first: what does a user of this API, command or tool
   actually type?
4. **Plan the order.** List what must come first, what can run in parallel,
   and what shares state. Each unit ends in a check.
5. **Build it in small units**, verifying and committing each one. Every
   surface gets the same behavior: if it is a content operation, CLI, MCP and
   Studio must agree.
6. **Errors.** A new failure that crosses a package boundary is a
   `GraftError` with a code and a `fix`. Run `pnpm docs:errors` and commit
   the result.
7. **Docs.** A user-visible change updates its docs page in the same PR
   (`graft-writing`). A new surface gets a `graft-verify` feature file.
8. **Verify** with `graft-verify` on every surface you touched, plus
   `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and the package's tests.
9. **Changeset** for each published package you changed.
10. If the design was contested, run [review](review.md) before the PR.
11. Run [opening-a-pr](opening-a-pr.md).

**Reply:** what a user can now do, the design choices and the alternatives
you rejected (a table when there were several), the verification evidence,
and open decisions.
