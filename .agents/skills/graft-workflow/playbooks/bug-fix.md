# Bug fix

Every line you ship traces to evidence. A change that "might help" is a
hypothesis, and hypotheses do not ship.

1. **Reproduce it yourself** on the surface where it was reported, with
   `graft-verify`. If it will not reproduce, narrow the conditions or add
   logging until it does. Ask the user only for something you cannot reach,
   and say what.
2. **Find the cause.** List candidate causes, then rule them out with runtime
   evidence, taking the test that eliminates the most candidates first. Check
   history (`git log -S`, the PR that touched it) for a regression.
3. **Write the failing test** that captures the bug, when a cheap one exists
   (unit or `*.integration.test.ts`). Run it and see it fail for the right
   reason.
4. **Fix the cause**, at the layer that owns the contract. Revert anything a
   disproved hypothesis motivated.
5. **Verify on the same surface.** The original reproduction now passes. A
   passing unit test alone does not prove the bug is gone.
6. **Commit the test before the fix**, so history shows it failing first.
7. Add a changeset if a published package changed. If the bug was an error
   message, check its `fix` line too.
8. Run [opening-a-pr](opening-a-pr.md).

**Reply:** what was broken and for whom, the root cause, the fix, and the
failing-then-passing output pasted verbatim.
