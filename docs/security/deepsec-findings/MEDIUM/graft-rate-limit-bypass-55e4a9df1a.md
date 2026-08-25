# [MEDIUM] Backstop rate limit keyed on spoofable X-Forwarded-For header

**File:** [`packages/cli/src/commands/serve.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/serve.ts#L212-L213) (lines 212, 213)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

startServe wires a handler-wide rate limit of 60 req/min (L213) as the abuse backstop. The rate identity for anonymous callers comes from clientIp() in packages/core/src/functions-handler.ts, which blindly trusts the first value of X-Forwarded-For (falling back to X-Real-IP). When graft serve is exposed directly (its primary self-host topology, no reverse proxy stripping the header), an unauthenticated attacker rotates X-Forwarded-For values to get unlimited fresh rate buckets, nullifying the backstop for expensive/public functions and approval-request flooding (each gated call inserts an approval row).

## Recommendation

Only honor forwarded headers when the request came through a trusted proxy (configure a trusted-proxy flag / proxy count), otherwise key on the socket remote address. Surface the real peer address through createNodeListener so handlers don't depend on headers.

## Revalidation

**Verdict:** true-positive

Verified in packages/core/src/functions-handler.ts: clientIp() returns forwarded.split(',')[0].trim() from X-Forwarded-For (falling back to X-Real-IP) with no trusted-proxy configuration, and the rate key for anonymous callers is `ip:${ip}`. startServe mounts this as the handler-wide 60 req/min backstop (serve.ts L212-213), and graft serve's primary topology is direct exposure of the Node listener with no proxy stripping headers. An unauthenticated attacker rotates X-Forwarded-For per request to get a fresh bucket each time, nullifying both the backstop and any per-function limits on public functions. Concrete impact: unlimited hammering of expensive functions and unbounded filing of approval rows plus audit rows (each gated call inserts into approvals/audit_log before any human looks) — a persistent-noise/DoS vector against the very tables the human gate depends on. Not mitigated anywhere else (no proxy-count option, no socket-address plumbing through createNodeListener). MEDIUM is appropriate for an abuse-control bypass rather than direct compromise.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
