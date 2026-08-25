# [MEDIUM] Anonymous rate limiting keyed to spoofable X-Forwarded-For value; concurrent requests outrun the counter

**File:** [`examples/docs-site/src/pages/api/fn/[name].ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/docs-site/src/pages/api/fn/[name].ts#L39-L40) (lines 39, 40)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

Same chain as the landing page: the createFunctionsHandler instance constructed here derives the anonymous rate key from clientIp() (first x-forwarded-for entry — client-controlled when proxies append), so submitContact's 5/60s public-mutation limit can be evaded by rotating that header, flooding the shared Postgres with submission rows. The audit-row count check also races: concurrent invocations read the same count before any of them record, permitting bursts above the configured limit.

## Recommendation

Prefer the last XFF hop or platform-injected client IP for rate identity, expose a trusted-proxy-count knob on createFunctionsHandler, and move the limit check to an atomic increment.

## Revalidation

**Verdict:** true-positive

Both mechanisms verified in packages/core/src/functions-handler.ts, from which this route builds its handler with no overrides (and FunctionsHandlerOptions offers no trusted-proxy knob to override with). clientIp() returns forwarded.split(",")[0] — the FIRST x-forwarded-for hop, which is client-controlled whenever the edge proxy appends (Vercel-style behavior) and used verbatim when no proxy exists; the anonymous rateKey is ip:<that value>, and docs-site graft.config.ts defines submitContact as public:true with a 5/60s limit. Attack: rotate X-Forwarded-For per request and each request gets a fresh rate identity, permitting unbounded anonymous inserts into the shared Postgres submissions table (storage exhaustion, PII-slot pollution, audit noise). The race claim also verifies: the limiter is a plain SELECT COUNT over audit_log rows (createDbAuditStore.countSince), while record() executes only after invoke() completes, so N concurrent requests all read the same count before any row lands, bursting past the configured limit. One imprecision: the cited lines 39-40 are actually the db factory (the operative bits are the handler construction at L44 and the core-handler clientIp/count logic), but the substance of the finding is accurate. MEDIUM fits — bypass of a public-form abuse control, not direct data exposure.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
