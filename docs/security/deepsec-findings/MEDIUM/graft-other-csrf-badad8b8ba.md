# [MEDIUM] Cross-site request forgery against the unauthenticated loopback Studio can decide approvals, commit content and trigger compiles

**File:** [`packages/studio/src/api.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/api.ts#L425-L551) (lines 425, 468, 540, 551)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-csrf`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

On loopback deployments authorize is undefined by design (no auth), and the API has no Origin/Sec-Fetch metadata check, no CSRF token, and no SameSite-style protection. Because Request.json() parses bodies regardless of Content-Type, the state-changing POST routes — approvals/{id}/decide (L540), changes/commit (L468), compile (L425), compilations/{id}/revert — are reachable via cross-origin 'simple requests': a malicious web page open in the operator's browser can send fetch('http://127.0.0.1:4983/api/studio/v1/approvals/<id>/decide', {method:'POST', body:'{"decision":"approved"}'}) with Content-Type text/plain, which browsers dispatch WITHOUT a CORS preflight. The handler parses it as JSON and executes. Concretely, any visited webpage can silently approve/deny pending approvals (defeating the human gate for destructive ops), commit attacker-selected content files, or trigger recompiles while graft studio runs locally. GET endpoints are likewise dispatched cross-origin (responses unreadable without CORS headers, but side-effecting GETs such as asset presigning still execute). With DNS rebinding (the Node adapter trusts the Host header blindly), reads and even preflighted writes become fully readable/writable too.

## Recommendation

Reject state-changing requests whose Origin header is present and not an allowed loopback origin, or require a custom header (e.g. X-Graft-Studio: 1) that forces a CORS preflight, and validate Content-Type: application/json on JSON routes.

## Revalidation

**Verdict:** true-positive

Verified the absence of every relevant defense. Case-insensitive search across packages/studio/src finds no Origin/Referer/Sec-Fetch validation, no CSRF token, no CORS headers, and no Content-Type enforcement on any API route; handlers call request.json() directly, and undici's Request.json() parses regardless of Content-Type, so cross-origin 'simple requests' with text/plain JSON bodies execute without preflight. State-changing routes reachable this way include compile (no id needed), changes/commit, document PUT, revert, and approvals/<id>/decide (api.ts L425, L468, L540, L650, L575). On loopback mounts authorize is deliberately undefined in both studio.ts and serve.ts, so no credentials are needed. The Host-header claim also checks out: createNodeListener builds the Request URL from `req.headers.host` verbatim (serve.ts), enabling DNS rebinding for full read+write access (list approvals, then decide them by id). Honest caveat: modern Chrome's Private Network Access blocks public-page→loopback subresources unless a PNA preflight passes, and pure blind CSRF cannot read UUID approval/compilation ids — but Firefox/Safari lack equivalent enforcement today, blind writes (compile trigger, guessed-slug document PUT feeding F9's render execution) work everywhere, and rebinding defeats IP-based PNA classification. Medium severity is correct.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-19)
