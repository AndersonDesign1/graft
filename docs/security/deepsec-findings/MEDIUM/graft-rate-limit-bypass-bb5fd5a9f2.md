# [MEDIUM] Anonymous rate limiting keyed to spoofable X-Forwarded-For value; concurrent requests outrun the counter

**File:** [`examples/landing-page/app/api/fn/[name]/route.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/app/api/fn/[name]/route.ts#L44-L47) (lines 44, 47)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The handler built here delegates anonymous rate identity to clientIp() (packages/core/src/functions-handler.ts), which returns x-forwarded-for.split(",")[0] — the FIRST, i.e. client-controlled, entry wherever the edge appends rather than replaces the header (self-host behind nginx/HAProxy with proxy_add_x_forwarded_for, various PaaS). An attacker rotates X-Forwarded-For per request to mint fresh `ip:<value>` keys, bypassing submitContact's 5/min cap and the 60/min handler-wide backstop, enabling unthrottled spam inserts into the submissions table (each insert is a paid DB write). Independently, the limiter is count-then-execute-then-record against audit_log rows with no transaction/lock, so N concurrent requests all observe the same count and execute before any row lands — a burst exceeding the limit even without header spoofing.

## Recommendation

Use the right-most untrusted-hop IP (last entry) or the platform-provided connection IP (e.g. Vercel's x-real-ip / x-vercel-forwarded-for) as the rate key, make the trust depth configurable per deployment, and consider an atomic counter (upsert-with-increment) or per-key token bucket to close the concurrency window.

## Revalidation

**Verdict:** true-positive

The route builds its handler with rateLimit {limit:60,windowSeconds:60} and delegates all rate identity to @usegraft/core's clientIp(), which I verified takes x-forwarded-for.split(',')[0] — the leftmost, client-supplied entry under standard XFF append semantics — and falls back to blindly trusting x-real-ip. Nothing in this route, the examples (no middleware.ts exists), or the core library validates the value or counts trusted hops. Concretely: self-hosted behind nginx/HAProxy with proxy_add_x_forwarded_for (or hit directly, where the header is 100% attacker-chosen), each request bearing a unique XFF mints a fresh 'ip:<value>' bucket, defeating both submitContact's 5/min cap and the handler-wide backstop; each admitted call inserts a paid data_records row. The concurrency half is also accurate: countSince is a plain SELECT COUNT (packages/db/src/audit.ts) executed before fn.handler runs, while the current attempt's audit row is only written after the response is built, so N concurrent requests all observe used<limit. Severity MEDIUM is right — it defeats a spam/backstop control, not authentication.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
