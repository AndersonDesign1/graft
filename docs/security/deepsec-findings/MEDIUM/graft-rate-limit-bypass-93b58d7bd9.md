# [MEDIUM] Public listComments query has no rate limit and attacker-controlled scan size

**File:** [`packages/registry/registry/comments/graft/comments.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/registry/comments/graft/comments.ts#L59-L63) (lines 59, 61, 63)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

listComments is public (queries default open) and declares no `rateLimit`, unlike its sibling postComment. Its `limit` input is an unbounded z.number() chosen by the caller (line 61): each invocation makes listRecords scan up to `limit` rows (default 100, but the attacker can send e.g. 1000000000) and re-validate every row through Zod on read (parseStoredRow), giving cheap, repeatable CPU/database amplification against the deployment with no per-caller throttle. A negative value additionally passes LIMIT -1 to Postgres, which errors out as FUNCTION_EXECUTION_FAILED (500 noise).

## Recommendation

Clamp limit server-side to a small maximum (e.g. min(input ?? 100, 200)), reject non-positive values, and attach a rateLimit to this function (or rely on a handler-wide default) once the rate-key issue below is fixed.

## Revalidation

**Verdict:** true-positive

Confirmed at module level: listComments declares no rateLimit (unlike sibling postComment) and its optional limit is an unclamped bare z.number() flowing into Drizzle .limit(). As a query with no access rule it is anonymous-open by design. Whether a deployment adds a handler-wide backstop is wiring-dependent (the landing-page example wires 60/min; the finding acknowledges this hedge), but nothing constrains the scan DEPTH: one request with limit=1e9 forces a full-collection read plus Zod revalidation per row (parseStoredRow), repeatable up to the backstop rate — cheap CPU/memory amplification against a public endpoint. The finding's negative-value observation is actually accurate (Postgres rejects negative LIMIT → 500 noise), unlike F2's phrasing. True-positive; MEDIUM justified by the amplification combined with storable megabyte rows.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
