# [MEDIUM] Anonymous caller can force a full-table scan / unbounded response via crafted listComments limit

**File:** [`examples/landing-page/graft/comments.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/graft/comments.ts#L58-L63) (lines 58, 60, 63)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-unbounded-query-limit`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

`limit` is `field.number` (bare `z.number()`: any finite value accepted, negatives included) and flows unvalidated into Drizzle's `.limit(ctx.input.limit ?? 100)` (packages/core/src/records.ts). PostgreSQL treats a negative LIMIT as "no limit" and huge positive values as unlimited scans, so `POST /api/fn/listComments {"pageSlug":"x","limit":-1}` makes the anonymous caller fetch every comment row on the branch into memory, re-validate each with Zod, then serialize them — a cheap single-request resource-exhaustion vector on a fully public endpoint that also has no per-function rateLimit (only the 60/min handler-wide backstop, itself XFF-bypassable). Confidentiality impact is nil (the approved-only filter still runs in memory), so this is availability/resource abuse rather than disclosure.

## Recommendation

Validate the bound server-side: clamp to a sane maximum (e.g. z.number().int().min(1).max(500)) or ignore non-positive/oversized values in the handler before calling listRecords; add a modest per-function rateLimit.

## Revalidation

**Verdict:** true-positive

Confirmed: limit is field.number() → bare ZodNumber (optional), flowing straight into Drizzle .limit(ctx.input.limit ?? 100) with no clamp anywhere in records.ts. A huge positive value (e.g. 1e9) makes the public, anonymous-reachable query fetch every comments row on the branch into Node memory and Zod-revalidate each (parseStoredRow), with megabyte bodies storable via postComment (no app middleware/body caps; data column is unbounded jsonb) — a genuine single-request CPU/memory amplification vector. The only backstop is the handler-wide 60/min limit wired in app/api/fn/[name]/route.ts, keyed on the spoofable first-XFF entry. One correction to the finding: PostgreSQL rejects negative LIMIT ('LIMIT must not be negative'), so limit:-1 yields a FUNCTION_EXECUTION_FAILED 500, not a full scan — but the finding's primary mechanism (attacker-chosen large scan size) is fully valid, so true-positive stands.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
