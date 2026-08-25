# [MEDIUM] Public submitContact accepts unbounded payloads and its rate limit is bypassable via spoofed X-Forwarded-For

**File:** [`examples/docs-site/graft.config.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/docs-site/graft.config.ts#L103-L113) (lines 103, 107, 111, 113)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

`submitContact` (L103-116) is an anonymous-callable mutation whose declared control is a 5/min-per-caller rate limit. Two compounding weaknesses make this control ineffective: (1) `input: submissions.fields` (L111) validates email/message with bare `z.string()` — the field builders in packages/core/src/field.ts offer no maxLength option — so a single request can carry a multi-megabyte `message` that is inserted verbatim into Postgres jsonb via insertRecord (L113). (2) The rate identity for anonymous callers comes from `clientIp()` in packages/core/src/functions-handler.ts, which trusts the FIRST entry of the client-supplied `X-Forwarded-For` header. In any deployment where the proxy appends rather than replaces XFF (typical self-host/Node setups), an attacker rotates the header per request to get a fresh rate bucket. Combined: unauthenticated, effectively unthrottled DB write amplification against data_records, leading to storage exhaustion/outage. All scanner-flagged 'weak cipher' lines in this file are false positives (they are description strings; no crypto exists here).

## Recommendation

Add length caps to field.string()/field.text() (or clamp in the handler) and validate email format; fix the rate identity in createFunctionsHandler to use the last trusted proxy hop (or platform-provided IP like Vercel's `x-real-ip` set by the edge) instead of the attacker-controlled first XFF entry.

## Revalidation

**Verdict:** true-positive

Verified end-to-end in examples/docs-site/graft.config.ts: submitContact is kind:'mutation', public:true, rateLimit {5/60s}, input: submissions.fields where email/message are field.string()/field.text(). packages/core/src/field.ts proves FieldOptions carries ONLY optional/description — BASE_ZOD builds bare z.string() with no max() anywhere, and defineFunction's handler pipeline adds no length clamping, so insertRecord writes ctx.input verbatim into the unbounded jsonb data column of data_records; Next.js App Router route handlers impose no default body-size cap. The rate-limit leg is equally real: anonymous identity is clientIp()'s leftmost XFF entry (see F2 analysis of functions-handler.ts), so in any append-style-proxy or direct deployment an attacker rotates the header to get unlimited fresh buckets. Combined attack is concrete: unauthenticated requests with multi-megabyte message fields at effectively unlimited rate produce unthrottled paid DB-write amplification and storage exhaustion. The scanner-note about 'weak cipher' lines being false positives is consistent with the file (those are prose strings). MEDIUM is right: denial-of-storage impact, no privilege escalation. The payload-cap and rate-key fixes belong in field.ts/core respectively, confirming this config-level finding as a fair co-location of both gaps.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
