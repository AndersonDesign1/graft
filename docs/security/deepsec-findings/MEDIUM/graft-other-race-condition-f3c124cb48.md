# [MEDIUM] updateRecord read-merge-write race silently loses concurrent updates (TOCTOU)

**File:** [`packages/core/src/records.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/core/src/records.ts#L201-L247) (lines 201, 211, 221, 222, 230, 237, 243, 247)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

updateRecord implements patch semantics as SELECT baseline (lines 201-211), merge the patch in JavaScript over the stored document (line 221), then write the FULL merged document back (line 237). There is no transaction, no SELECT ... FOR UPDATE row lock, and no optimistic-concurrency guard (version column or staleness predicate) in the final UPDATE's WHERE clause. Attack/error scenario: two authenticated callers (e.g. two moderators, or an agent and a human) invoke functions that call updateRecord on the same record concurrently. Both SELECTs read the same baseline document; each merges its own patch over that stale baseline; both full-document writes succeed. Last writer wins and the first caller's change is silently discarded — no error is returned to either side. This is exactly the primitive the doc comment advertises for state transitions ('approve a comment, advance an order'), where concurrent transitions are expected, so a lost update can revert an approval/rejection or roll back an order-status change without any signal. Secondary effect of the same window: if the row is deleted (deleteRecord) between the SELECT and the UPDATE, the UPDATE matches zero rows and control reaches line 247 — `throw new Error("update returned no row")`, which the comment incorrectly labels 'unreachable' — surfacing as FUNCTION_EXECUTION_FAILED/500 instead of DOCUMENT_NOT_FOUND.

## Recommendation

Make the read-modify-write atomic. Preferred: wrap in a transaction and lock the row (SELECT ... FOR UPDATE) before merging; or use optimistic concurrency — add a version/updated_at column, carry the value read at SELECT time into the UPDATE's WHERE clause, and return DOCUMENT_NOT_FOUND/retryable-conflict when zero rows are affected instead of the raw Error. A JSONB-level patch (jsonb_set / || merge performed inside Postgres) would also close the window.

## Revalidation

**Verdict:** true-positive

updateRecord performs SELECT baseline (no .for('update'), no surrounding transaction), merges the patch in JavaScript over that stale snapshot ({...existing.data, ...patch}), and writes the FULL merged document back with a WHERE clause limited to id+branchId+collection — no version column, no updated_at predicate, no row lock. Under Postgres READ COMMITTED two interleaved invocations (realistic here: agents and humans moderating the same queue through typed functions) both read the same baseline, both merges succeed independently, and the second write silently erases the first caller's fields with no error to either side — precisely the approve-a-comment/advance-an-order primitive the doc comment advertises. The secondary observation is also correct: if deleteRecord removes the row between SELECT and UPDATE, the UPDATE affects zero rows, control reaches the mislabeled-unreachable `throw new Error("update returned no row")`, and the caller gets FUNCTION_EXECUTION_FAILED/500 instead of DOCUMENT_NOT_FOUND. No framework-level mitigation exists (records helpers are the only write path and none take locks). A concrete exploit is two concurrent updateRecord calls toggling status on the same record — one transition is silently reverted. MEDIUM fits: silent data loss, but requiring authenticated access to an update-bearing function.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
