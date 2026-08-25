# [BUG] Unbounded qty allows floating-point overflow, corrupting order totals

**File:** [`packages/registry/registry/commerce/graft/commerce.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/registry/commerce/graft/commerce.ts#L158-L207) (lines 158, 207)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

qty is validated only as an integer >= 1 (L158); there is no upper bound. At L207 `totalCents += product.priceCents * line.qty` operates in IEEE doubles, so qty values beyond Number.MAX_SAFE_INTEGER / priceCents silently lose precision — e.g. priceCents=999 with qty=2^53 yields a rounded, incorrect totalCents that is persisted as the authoritative order total. Orders with nonsensical quantities (10^15 units) are also accepted and stored. With no payment provider this is primarily a data-integrity problem, but any downstream fulfillment/invoicing logic consumes these corrupted totals.

## Recommendation

Add a sane upper bound on qty (e.g. <= 100000) and/or compute totals with integer-safe arithmetic (BigInt) or validate totalCents <= Number.MAX_SAFE_INTEGER before persisting.

## Revalidation

**Verdict:** true-positive

Same defect as F5 in the registry copy: qty validated only as finite integer ≥1 with no upper bound (L158 area), then totalCents += product.priceCents * line.qty (L207) in IEEE doubles — any product of price×qty beyond 2^53 silently rounds, and the imprecise total is persisted to jsonb and returned as authoritative. Reachable anonymously via public:true placeOrder; e.g. priceCents=999 with qty=10^15 yields a rounded, wrong stored total, and absurd quantities are accepted outright. No confidentiality impact and no payment provider, so data-integrity/logic-bug classification (BUG) is correct, exactly as filed. Identical mechanism to F5 but different file (registry vs example), hence not a duplicate. True-positive.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
