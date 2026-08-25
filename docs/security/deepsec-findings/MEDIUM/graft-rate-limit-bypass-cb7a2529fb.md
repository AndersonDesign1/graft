# [MEDIUM] postComment stores unbounded author/body strings behind a header-spoofable rate limit

**File:** [`examples/landing-page/graft/comments.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/graft/comments.ts#L33-L47) (lines 33, 37, 43, 44, 47)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The public mutation postComment (L33-50) is protected solely by `rateLimit: { limit: 5, windowSeconds: 60 }` (L37), which createFunctionsHandler counts against a rate key derived from the first entry of the client-controlled `X-Forwarded-For` header for anonymous actors (packages/core/src/functions-handler.ts `clientIp()`). An anonymous attacker rotating that header obtains unlimited invocations, and since `author` (L43) and `body` (L44) compile to bare `z.string()`/`z.text()` with no maximum length, each call can persist megabyte-scale rows into the shared data_records table (insertRecord performs no truncation). Beyond storage exhaustion, this accelerates the scan-window pollution attack on listComments described separately. Moderation itself is sound: approved is forced to false server-side (L47).

## Recommendation

Bound author (e.g. 100 chars) and body (e.g. 5-10k chars) via new maxLength support in field builders or explicit handler checks; fix anonymous rate identity to use the trustworthy remote address (last hop added by your own proxy / platform header).

## Revalidation

**Verdict:** true-positive

Verified: author/body compile to bare z.string() (field.ts BASE_ZOD), insertRecord performs schema-validate-then-insert with no truncation, and data_records.data is unbounded jsonb (packages/db/src/schema.ts L107). The sole throttle is rateLimit {5/min} whose anonymous identity is clientIp()'s FIRST x-forwarded-for entry (functions-handler.ts L115-118) — attacker-controlled whenever a proxy appends (standard behavior) or when the app is exposed directly, so header rotation yields fresh buckets and effectively unlimited inserts of arbitrarily large rows. Next.js App Router route handlers impose no default body-size limit and no middleware exists in the example. Moderation integrity is indeed sound (approved forced false at L47). Exploitation depends somewhat on proxy topology, but the code-level weakness is real; MEDIUM is appropriate.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
