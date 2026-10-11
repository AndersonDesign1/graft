# Long run

The user is away, or the task spans sessions. Cloud containers are reclaimed
when idle, so anything not pushed is lost.

1. **Write the done condition** as something you can check: "every caller of
   `X` uses `Y`, `pnpm typecheck` passes, `X` is deleted".
2. **Keep a decision log** at `.agents/run-log.md` on your working branch:
   one line per decision with the time, what you chose, the alternative, and
   the evidence. The user reads this when they return.
3. **Work in verified units.** Run the checks that cover the unit (lint,
   typecheck, the tests of what it touched), commit it, and push, so a
   reclaimed container loses at most one unit. The full checklist in
   `opening-a-pr.md` is for the push that opens or updates the PR.
4. **Decide reversible forks yourself** and log them. Stop only for the
   Always-ask list in `SKILL.md`.
5. **Hand off cleanly** before you stop or when context is nearly full:
   update the log with what is done, what is in flight (branch, PR, the
   exact next command), and what is blocked and on whom. Push.
6. **Picking up someone else's run:** read the log and the branch, check out
   the branch, run its verification, and confirm the state matches the log
   before continuing.
7. Before the final PR, move anything the reviewer needs from the log into
   the PR body, and delete the log from the branch unless the user asked to
   keep it.

**Reply:** the done condition and whether it holds, the decision log's key
entries, and what is left.
