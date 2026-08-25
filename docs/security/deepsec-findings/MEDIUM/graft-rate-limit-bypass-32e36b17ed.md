# [MEDIUM] Rate-limit identity taken from client-controlled x-forwarded-for header

**File:** [`packages/core/src/functions-handler.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/core/src/functions-handler.ts#L115-L291) (lines 115, 117, 118, 208, 291)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

clientIp() (L115-118) uses request.headers.get('x-forwarded-for').split(',')[0] — the leftmost entry, which per XFF convention is the value appended first, i.e., supplied by the client, not the trusted proxy. For anonymous callers this value IS the entire rate-limit identity (rateKey() -> `ip:${ip}`, L208/L226), so an attacker can send a unique x-forwarded-for value with every request ('ip:1.2.3.4', 'ip:1.2.3.5', ...) and receive an unlimited number of fresh buckets, completely defeating fn.rateLimit and options.rateLimit. x-real-ip is likewise trusted blindly when XFF is absent. There is no trusted-proxy count or allowlist anywhere in the repo. Concrete impact: 'graft serve' always installs a backstop { limit: 60, windowSeconds: 60 }, so every deployment is affected; public queries/mutations (and destructive functions exposed with custom access) can be invoked without bound, and each ungated attempt additionally inserts a row into the approvals table (L317), letting an attacker flood the human approval queue to bury malicious requests among spam or exhaust DB storage. Bypassing rate limits also removes the anti-brute-force/backstop control for any function relying on it.

## Recommendation

Never use client-supplied header values directly as rate identity. Use the connection peer address provided by the platform/runtime, or take the rightmost entry added by infrastructure you control based on a configured trusted-proxy count (e.g., numProxies setting), and validate the extracted value looks like an IP. Alternatively, require authenticated actors for anything rate-sensitive and treat header-derived identities as untrusted hints.

## Revalidation

**Verdict:** true-positive

Confirmed at source: clientIp() (L115-118) returns the FIRST x-forwarded-for entry, which per XFF convention is the value appended first, i.e., supplied by the originating client whenever any proxy appends rather than replaces; x-real-ip is likewise trusted unvalidated. rateKey() (L231-233) uses this value verbatim for every anonymous caller, and countSince (db/src/audit.ts L51-63) is an unauthenticated-string-match COUNT against audit_log — no HMAC, no allowlist, no trusted-proxy depth anywhere in the repo. 'graft serve' mounts the handler on a raw node:http server (cli/src/commands/serve.ts), where headers arrive straight from the client socket, so even the flagship self-host path is fully spoofable; the serve.ts loopback warning covers auth, not header trust. Impact claims check out: the 60/min backstop installed by both serve.ts and the example routes is void; and for a function that is both public and destructive, anonymous callers pass the access stage (public:true) and reach the gate, where each ungated attempt INSERTs an approvals row (stores.approvals.request), enabling queue-flooding once the limiter is bypassed. The unit test at functions-handler.test.ts:422 confirms the implementation deliberately keys on the first entry. Concrete attack: curl loop with '-H x-forwarded-for: 10.0.0.<n>' yields unlimited invocations. MEDIUM stands.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
