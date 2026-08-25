# [MEDIUM] Attacker-controlled Host header is trusted when synthesizing the request URL; Studio shell 302 reflects it in Location

**File:** [`packages/cli/src/commands/serve.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/serve.ts#L95-L101) (lines 95, 101)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-open-redirect`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

createNodeListener builds the internal Request URL from the raw Host header: http://${req.headers.host}${req.url} (L101). Downstream, createStudioHandler derives absolute URLs from this for its trailing-slash/branch-pinning redirect (Response.redirect(url.toString(), 302) in packages/studio/src/handler.ts) — and that redirect runs BEFORE the authorize callback (only /api/studio/* routes pass through authorize), so on any deployment with --studio mounted, an unauthenticated request with Host: evil.com and path /studio (or / for graft studio) receives 302 Location: http://evil.com/studio/?branch=main. Behind a caching proxy or CDN that caches 302s keyed by path this enables redirect-cache poisoning; combined with DNS rebinding it smooths the local attack described elsewhere. Routing itself also parses the attacker-influenced URL, allowing path-prefix confusion between router branches.

## Recommendation

Validate the Host header against the configured bind host (reject unknown hosts with 400), or construct redirect targets from server configuration rather than the request's Host header, and mark the 302 non-cacheable (Cache-Control: no-store).

## Revalidation

**Verdict:** uncertain

The code behavior is confirmed: createNodeListener synthesizes new Request(`http://${req.headers.host}${req.url}`) with no Host allowlist (serve.ts ~L95-101), and createStudioHandler's trailing-slash/branch-pinning redirect runs BEFORE authorization (authorize is only consulted inside the API for /api/studio/v1), reflecting the Host into Response.redirect(url.toString(), 302) Location. So Host: evil.com against /studio yields Location: http://evil.com/studio/?branch=main — genuine host-header reflection on an unauthenticated route. What I cannot establish from source is victim delivery: browsers always send the true Host, so the only standalone effect reflects back to the attacker; meaningful impact requires an intermediary that caches 302s keyed by path while forwarding attacker-controlled Host (a stacking of external misconfigurations the audited code neither provides nor controls), and under DNS rebinding the redirect adds nothing since the rebound Host is already attacker-owned. The routing-confusion side claim is weak too (routing uses pathname, which Host doesn't influence; absolute-form request lines just produce an invalid URL and a 500). Real defect worth fixing (host allowlist / no-store), but concrete exploitable harm is deployment-dependent and cannot be confirmed statically — hence uncertain rather than a confident true/false positive.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
