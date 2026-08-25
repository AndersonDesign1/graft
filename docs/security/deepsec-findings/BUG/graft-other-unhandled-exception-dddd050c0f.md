# [BUG] Malformed percent-encoding in UI asset path throws URIError, escaping the handler as a generic 500

**File:** [`packages/studio/src/handler.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/handler.ts#L52-L141) (lines 52, 74, 141)
**Project:** graft
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-unhandled-exception`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

resolveUiFile() calls decodeURIComponent(rel) (L52) on a path segment taken straight from the request pathname. Unlike the API branch, the static-serving branch of createStudioHandler has no try/catch, so a request like GET /studio/%zz makes decodeURIComponent throw URIError, which propagates out of the handler entirely; the Node adapter (createNodeListener) catches it and answers with a misleading 500 FUNCTION_EXECUTION_FAILED ('the adapter should never throw'). The same pattern exists inside api.ts for decodeURIComponent of approval/revert ids (there it lands in the try/catch but is rethrown because URIError is not a GraftError). Not exploitable beyond log noise / wrong status codes — path containment itself (resolve + prefix check) correctly blocks ../, absolute paths, NUL and Windows separators, and the redirect target only ever reuses the request's own origin.

## Recommendation

Wrap decodeURIComponent in try/catch and return null (404) on malformed input, both in resolveUiFile and for decoded route ids in api.ts.

## Revalidation

**Verdict:** true-positive

Verified both escape paths. resolveUiFile() (handler.ts L52) calls decodeURIComponent(rel) on the raw pathname segment BEFORE the containment check and before serveUiAsset's try/catch (which only wraps readFileSync after resolution); createStudioHandler itself has no try/catch around the static branch, so GET /studio/%zz throws URIError out of the handler into createNodeListener's catch-all, which returns a misleading 500 FUNCTION_EXECUTION_FAILED ('the adapter should never throw') — WHATWG URL parsing preserves invalid percent sequences like '%zz' in pathname, so the input is reachable. Same class inside api.ts: decodeURIComponent of the approval/revert route ids sits inside the big try/catch but URIError is not a GraftError, so it is rethrown and likewise surfaces as the adapter's generic 500 instead of a 4xx. As the finding states, containment itself is sound (resolve+prefix blocks ../, absolute paths, NUL, Windows separators) and the redirect reuses only the request origin, so impact is confined to wrong status codes and log noise. Accurate BUG.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
