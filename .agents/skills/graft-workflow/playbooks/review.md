# Review

Find what would break. Do not edit unless asked.

1. **Scope.** The diff against the PR's own base: `git diff
   origin/main...HEAD`, with `main` replaced by the PR's base
   branch if it differs. Or the PR's files.
2. **Intent.** One paragraph on what the change is meant to do, from the PR
   body, commits and code. If you cannot tell, ask before reviewing.
3. **Spawn two reviewers in parallel**, read-only, each on a different model
   (for example `opus` and `sonnet`), with the same prompt: the intent, the
   diff, and the lenses below. Model diversity is the point; do not give them
   personas.
4. **Lenses**, applied where relevant:
   - Correctness: edge cases, empty and missing input, errors swallowed,
     what happens if it runs twice or crashes halfway.
   - Root cause: does it fix the contract, or guard a symptom?
   - Graft invariants: git stays authoritative, validation is the one Zod
     layer, destructive work is gated, errors carry a `fix`, the scope and
     actor come from the server and never from the caller.
   - Security: path containment, credentials in logs or errors, input that
     reaches a shell, a query or a file path.
   - Structure: validation at the boundary, no new dual paths, no premature
     abstraction.
   - Proof: a test that fails without the change, tests that assert
     behavior, and verification on the real surface.
   - Words and design: `graft-writing` and `graft-design` checklists for
     any docs, error message or UI in the diff.
   Each finding needs the call chain or input that triggers it, not "this
   could be undefined".
5. **Judge as the lead.** Merge duplicates, note which models raised each,
   and sort into:
   - **Act on.** Would block a real PR.
   - **Consider.** Real, but the cost of fixing now is debatable.
   - **Noted.** Valid, not actionable now.
   - **Dismissed.** Wrong or missing context, with the reason.
6. For a PR, review-bot comments get the same
   treatment: verify each claim before acting on it.

**Reply:** intent, reviewers and models, the four buckets, and where the
models agreed or diverged.
