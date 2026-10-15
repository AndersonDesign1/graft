# Refactor

Behavior stays the same. Prove it before and after.

1. Say in one sentence what gets simpler, and for whom (the next reader,
   a caller).
2. Make sure tests cover the behavior you are about to move. Add the missing
   ones first, in their own commit, and see them pass on the old code.
3. Delete before you restructure: one-caller wrappers, stale compatibility
   paths, and exports nothing uses, inside the repo and outside it. An export
   of a published package can have users outside the repo; removing it is a
   breaking change, so it needs a changeset that says so, not a refactor.
4. Make the change with a script or codemod when it touches many files, and
   commit the script's output separately from hand edits.
5. Migrate every caller and delete the old API in the same PR.
6. Run the same tests, unchanged, and they pass. Run `pnpm typecheck`,
   `pnpm lint`, `pnpm check:registry-drift` if `packages/registry` or
   `examples/*/graft` changed.
7. Run [opening-a-pr](opening-a-pr.md).

**Reply:** what got simpler, what you deleted, and the proof behavior did not
change.
