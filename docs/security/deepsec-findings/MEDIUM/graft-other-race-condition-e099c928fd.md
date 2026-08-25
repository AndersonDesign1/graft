# [MEDIUM] TOCTOU race in rate limiting: counter read before invocation, audit row written after completion

**File:** [`packages/core/src/functions-handler.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/core/src/functions-handler.ts#L288-L385) (lines 288, 291, 382, 385)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The stateless rate limiter counts prior audit rows (stores.audit.countSince, L288-307) but the current invocation's audit row is only recorded after the function handler finishes and the response is built (options.audit !== false block, L382-395). Between the countSince SELECT and the eventual INSERT there is a window covering the entire handler execution. Firing N concurrent requests against a limited function means all N observe used < limit and are admitted — a burst bypass proportional to concurrency (e.g., 1000 simultaneous POSTs against a 60/min endpoint mostly succeed). Long-running handlers extend the blind window further. Even sequential-ish abuse gets a free multiplier of one extra admitted request per in-flight request. This partially defeats the documented invariant that 'every attempt counts'.

## Recommendation

Reserve the slot atomically before executing the handler: insert a provisional audit row (or a dedicated counter row with INSERT ... ON CONFLICT ... RETURNING / conditional UPDATE increment) prior to invoking fn.handler, then update its status/duration afterward. A single INSERT-before-execute closes the race while keeping the store stateless.

## Revalidation

**Verdict:** true-positive

The code sequence is exactly as described: countSince (L291) reads prior audit rows; admission is decided immediately; fn.handler(ctx) then runs for the entire duration; and the current invocation's audit row is only inserted in the best-effort audit block after outcome.response is built. The db-backed store is stateless — countSince is a plain SELECT COUNT and record is a plain INSERT with no transaction, advisory lock, or reservation slot — so under READ COMMITTED there is no serialization between the check and the eventual write. N concurrent requests therefore all observe the same 'used' value and are admitted; even fast handlers leave a window spanning JSON parsing, Zod validation, access checks, and the handler itself, and rejected attempts equally fail to count until after the 429 response is constructed, contradicting the in-code invariant 'every attempt counts'. A burst of concurrent POSTs proportionally exceeds any configured limit (e.g., ~100 simultaneous against a 60/min endpoint largely succeed). This is a classic count-then-act TOCTOU, exploitable by anyone who can open parallel connections; MEDIUM is appropriate for a throttling-control defeat rather than an auth bypass.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
