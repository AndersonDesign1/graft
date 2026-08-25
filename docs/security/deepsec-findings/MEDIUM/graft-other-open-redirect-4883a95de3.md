# [MEDIUM] Unauthenticated shell redirect reflects attacker-controlled Host header in Location

**File:** [`packages/cli/src/commands/studio.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/studio.ts#L92-L93) (lines 92, 93)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-open-redirect`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

graft studio serves the SPA shell at / and, when ?branch is absent, responds 302 to an absolute URL rebuilt from the request's Host header (via createNodeListener's new Request(`http://${req.headers.host}${req.url}`) in serve.ts plus Response.redirect(url.toString(), 302) in packages/studio/src/handler.ts). This redirect fires before any authorization (it is outside /api/studio/*), so any request with a poisoned Host — e.g. Host: evil.com — receives Location: http://evil.com/?branch=main. On hosted/proxied deployments where intermediaries may cache redirects, this enables redirect-cache poisoning; it also confirms the adapter has no Host allowlist, the root cause of the local DNS-rebinding exposure reported separately.

## Recommendation

Reject requests whose Host does not match the configured bind host, or build the redirect target from configured base URL rather than request input, with Cache-Control: no-store on the redirect.

## Revalidation

**Verdict:** uncertain

Mechanically confirmed: graft studio serves the SPA shell at /, and with ?branch absent createStudioHandler responds Response.redirect(url.toString(), 302) where url came from new Request(`http://${req.headers.host}${req.url}`) in serve.ts's createNodeListener — no Host allowlist exists anywhere, and the redirect fires outside /api/studio/v1 so no authorize callback applies (loopback mounts have none anyway). Host: evil.com therefore yields Location: http://evil.com/?branch=main. However, as with F7, I cannot construct a victim-facing attack from source alone: browsers emit the real Host, so the poisoned Location returns only to the attacker; exploitation needs an intermediary that caches redirects keyed by path while passing arbitrary Host headers, and under DNS rebinding the reflected redirect is useless (the Host is already the attacker's domain). It is a real missing-validation defect and the correct fix (host validation, no-store) also closes part of the rebinding exposure reported in F8/F10's siblings, but standalone exploitability is contingent on unverifiable deployment infrastructure — uncertain, with the finding's own low confidence being accurate.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
