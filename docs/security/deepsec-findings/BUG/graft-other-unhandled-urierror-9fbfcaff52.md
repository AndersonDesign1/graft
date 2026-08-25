# [BUG] Uncaught URIError from decodeURIComponent crashes the SPA on malformed hash routes

**File:** [`packages/studio/src/ui/lib/route.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/ui/lib/route.ts#L32) (lines 32)
**Project:** graft
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-unhandled-urierror`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

parseHash() calls decodeURIComponent on every segment of window.location.hash without guarding against malformed percent-encoding. Inputs such as '%', '%ZZ', '%FF', or lone-surrogate escapes ('%ED%A0%80') throw a URIError in all modern engines. Because parseHash runs inside the useState initializer of useRoute(), simply loading a URL with a malformed hash (e.g., http://127.0.0.1:4983/#/collections/%FF) throws during initial render and white-screens the entire Studio SPA until the operator manually edits the URL; the hashchange listener path also throws an unhandled exception. Any attacker can craft such a link (the hash is attacker-controlled in shared/phished URLs), producing reliable client-side denial of service for the operator's editing session. Note: the scanner's 'insecure-crypto' flag on this file is a false positive - there is no cryptographic code here.

## Recommendation

Wrap each decodeURIComponent call in try/catch (or use a safe-decode helper that falls back to the raw segment on URIError), so malformed hashes degrade to the overview view instead of throwing during render or event handling.

## Revalidation

**Verdict:** true-positive

Verified end-to-end in packages/studio/src/ui/lib/route.ts. Line 32 maps every hash segment through bare decodeURIComponent with no try/catch; per ECMA-262/WHATWG this throws URIError for '%', '%ZZ', '%FF' (invalid UTF-8), and '%ED%A0%80' (lone surrogate). The sink sits in two live paths: useRoute()'s useState lazy initializer (line 55), which runs synchronously during StudioApp's first render, and the hashchange listener (line 58). main.tsx mounts <StudioApp/> directly under createRoot and a repo-wide grep of src/ui finds no ErrorBoundary, componentDidCatch, or onUncaughtError handler, so a render-phase throw unmounts the tree and leaves a persistent blank SPA until the operator hand-edits the URL. Attack vector is concrete: browsers preserve percent-octets in location.hash verbatim without validating UTF-8, so a crafted/phished link like http://127.0.0.1:4983/#/collections/%FF reliably triggers the throw on load; fragments never touch the server, so no backend mitigation applies. Impact is bounded client-side denial of service of the operator's editing session (no XSS — the URIError throws before any decoded value reaches the DOM; no auth or data impact), which matches the assigned BUG severity, so no adjustment is needed. The code was introduced unchanged in commit 3fc8ea9 with no subsequent guard, ruling out 'fixed', and this is the only finding for this file, ruling out 'duplicate'. The finding's aside that the scanner's insecure-crypto flag on this file is a false positive is itself correct — the file contains no cryptographic code.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-07)
