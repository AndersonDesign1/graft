# [MEDIUM] placeOrder accepts unbounded items array, causing per-item sequential DB queries (DoS)

**File:** [`packages/registry/registry/commerce/graft/commerce.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/registry/commerce/graft/commerce.ts#L133-L174) (lines 133, 99, 171, 174)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-unbounded-input`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

placeOrder is a public (anonymous-reachable) mutation. Its `items` input compiles to a plain z.array() with no maximum length (field.array has no cap; the handler only rejects length===0 at L145). loadProducts() then executes ONE SEQUENTIAL database query per unique slug (L99-108: `await ctx.db.query.contentIndex.findFirst(...)` inside a for-loop, invoked from L171-174). An anonymous attacker can submit a single request with tens of thousands of distinct productSlug values, forcing tens of thousands of serial round-trips while holding a pooled Postgres connection. Because the functions handler shares one db pool across all functions/branches, a handful of such requests exhausts connections and stalls unrelated functions (denial of service). Additionally, the full snapshot array is persisted verbatim via insertRecord, so each crafted order row can be arbitrarily large, bloating the data_records table. The 10/min rate limit does not constrain per-request work, so one request is sufficient.

## Recommendation

Cap items.length (e.g. max 100) in the Zod schema or the handler, cap productSlug string length, and batch-load products with a single `inArray` query instead of one findFirst per slug.

## Revalidation

**Verdict:** true-positive

Fully confirmed in packages/registry/registry/commerce/graft/commerce.ts: items is a plain z.array() with no element cap (handler only rejects length===0), and loadProducts awaits one contentIndex.findFirst per unique slug inside a for-loop — invoked before any unknown/inactive-slug rejection, so a single anonymous request carrying e.g. 50,000 distinct bogus slugs (a ~1.5MB body; no body-size guard exists) executes 50,000 serial DB round-trips while holding a pooled connection, then fails with INPUT_VALIDATION_FAILED after the damage. The db handle is shared across functions/branches (createFunctionsHandler injects one pool), so a handful of such requests starves unrelated functions — concrete denial-of-service. Snapshot array also persisted verbatim, bloating data_records. The 10/min limit genuinely doesn't constrain per-request work. High-confidence true-positive; MEDIUM reasonable for a demo/template endpoint.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
