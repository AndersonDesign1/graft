# [MEDIUM] Loopback Studio mounts authorize=undefined with no Origin/CSRF/Host validation — drive-by webpages can approve destructive ops and edit content

**File:** [`packages/cli/src/commands/serve.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/serve.ts#L282-L292) (lines 282, 283, 292)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-csrf-dns-rebinding`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

On loopback binds the Studio authorize callback is undefined (L282-283), which the Studio API treats as 'no authentication required', and the Node adapter (createNodeListener) performs no Origin, Sec-Fetch-Site, or Host validation anywhere. Every Studio mutation is a plain stateless POST/PUT that parses JSON bodies regardless of Content-Type, so a malicious webpage visited by the developer can send no-cors cross-site POSTs to http://127.0.0.1:<port>/api/studio/v1/... and successfully drive approve/deny decisions, PUT /document (writes arbitrary frontmatter/body into content files), /changes/commit, /compilations/:id/revert, and /compile — responses are unreadable but side effects execute. DNS rebinding additionally grants full read access (content tree, raw documents, pending approval inputs). This converts a browser drive-by into remote execution of the operator's most privileged actions, including defeating the human gate while a destructive-op approval is pending review.

## Recommendation

Validate Host against the configured bind host and reject mismatches (defeats DNS rebinding), reject requests whose Origin/Referer is cross-origin, or require a token even on loopback for mutating endpoints (e.g. echo a per-process secret the SPA injects as a header). At minimum, gate approval-decision endpoints behind authentication even when bound to loopback.

## Revalidation

**Verdict:** true-positive

Verified: on loopback the serve.ts ternary yields authorize === undefined (L282-283), and createStudioApiHandler only authenticates `if (options.authorize)` — so every Studio mutation is unauthenticated locally. Repo-wide grep confirms no Origin/Sec-Fetch-Site/Host/CSRF handling anywhere in server code (only Vite dev-proxy config and UI-side code), and createNodeListener builds the Request solely from method/headers/body with no validation. Every mutation uses request.json(), which parses the body regardless of Content-Type, so a webpage's no-cors cross-site POST (JSON serialized as text/plain) executes side effects: decisions, PUT /document file writes, commits, revert, compile — opaque responses don't matter. DNS rebinding additionally defeats SOP for reads (content tree, raw documents, pending approval inputs incl. ids needed for targeted CSRF), and Host-header-based routing has no allowlist to stop it. Browser mitigations (Chrome Local Network Access) are incomplete across browsers and don't cover co-resident processes; this remains the classic unprotected-localhost-admin class. Medium confidence is fair given dependence on browser environment, but the missing controls are objectively present. True positive at MEDIUM.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
