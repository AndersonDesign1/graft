# Correct

The user corrected an agent for something an agent has done before. Make it
impossible, not just discouraged.

1. **Name the mistake class** and find two real instances (commits, review
   comments, reverts, this session).
2. **Fix it at the highest level that works:**
   1. Architecture: one owner per piece of state, one supported way per
      task, delete the old way an agent would copy.
   2. Types: make the wrong code fail to compile.
   3. A check: a lint rule in `.oxlintrc.json` or a `check:*` script whose
      error names what to use instead. Wire it into CI and `pnpm` scripts.
   4. A test of the behavior.
   5. Words last: a line in `AGENTS.md`, `DESIGN.md` or a skill, only for
      judgment calls a machine cannot check.
3. **Prove the check fails** on a real past instance before you rely on it.
   For a words-only rule (step 5 above), quote the past instance it would
   have caught instead.
4. **Record it** in the rules table in `AGENTS.md`: the rule, what enforces
   it, and the evidence. If the rule was already there with nothing
   enforcing it, move it up a level in the same change.
5. Run [opening-a-pr](opening-a-pr.md).

**Reply:** the class, its instances, the level you chose and why a higher one
did not work, and the check failing on the old code.
