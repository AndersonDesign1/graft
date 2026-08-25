# [MEDIUM] Public placeOrder: unbounded items array drives sequential per-item DB queries; email unbounded; rate limit keyed on spoofable header

**File:** [`examples/landing-page/graft/commerce.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/graft/commerce.ts#L127-L204) (lines 127, 131, 136, 137, 93, 99, 204)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

placeOrder (L127-217) is anonymous-callable with `rateLimit: { limit: 10, windowSeconds: 60 }` (L131), but the anonymous rate key is the first entry of the client-supplied `X-Forwarded-For` header (packages/core/src/functions-handler.ts `clientIp()`), so it is bypassable by header rotation. Three amplifiers then apply per request: (1) `items` is `z.array(...)` with no maximum element count (L137-145); (2) loadProducts (L93-124) issues one sequential `findFirst` round-trip per unique slug with no batching, so a request containing tens of thousands of distinct productSlug strings ties up a DB connection for that many serial queries before responding; (3) `email` (L136) has no length/format cap, so each surviving request persists attacker-sized rows via insertRecord (L204). Net: unauthenticated connection-pool exhaustion and storage bloat. Pricing integrity itself is solid — unit prices are looked up server-side from content_index (L196-201), never taken from client input.

## Recommendation

Cap items length (e.g. <= 50) in Zod/handler; batch the catalog lookup into a single IN(...) query; bound email length and format; fix the anonymous rate identity to use a trustworthy source IP.

## Revalidation

**Verdict:** true-positive

All three amplifiers confirmed in source. items compiles to plain z.array() with no max (only length===0 rejected at the top of the handler); loadProducts loops over unique slugs issuing one awaited ctx.db.query.contentIndex.findFirst per slug — and crucially this happens BEFORE unknown-slug rejection, so a payload of tens of thousands of distinct bogus slugs forces tens of thousands of serial round-trips while holding a pooled connection before the handler errors with INPUT_VALIDATION_FAILED; email is bare z.string() persisted verbatim into jsonb. placeOrder is public:true, anonymous-callable, and its 10/min limit is keyed on the spoofable first-XFF entry (clientIp(), confirmed by the package's own test). A few concurrent crafted requests exhaust the shared db pool and stall unrelated functions. Pricing integrity is correctly noted as sound (server-side lookup). Concrete attack fully describable; MEDIUM fits.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
