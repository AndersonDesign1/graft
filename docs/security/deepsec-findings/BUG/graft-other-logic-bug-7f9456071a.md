# [BUG] placeOrder qty has no upper bound, allowing totals beyond safe integer precision

**File:** [`examples/landing-page/graft/commerce.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/graft/commerce.ts#L157-L212) (lines 157, 158, 201, 212)
**Project:** graft
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

Line-item validation (L157-166) enforces `Number.isInteger(qty) && qty >= 1` but no ceiling, so `qty: 9007199254740991` passes. `totalCents += product.priceCents * line.qty` (L201) then exceeds Number.MAX_SAFE_INTEGER for any price > 1 cent; the value is stored in a jsonb column as a double and returned to the caller (L212), producing silently corrupted order totals. There is no payment provider in this demo so direct financial loss is limited, but any downstream fulfillment/billing logic consuming totalCents would receive garbage, and a single request can also allocate enormous snapshotted arrays. Same missing-bound pattern affects the scope-gated listOrders `limit` (L225-230), where a negative value reaches SQL LIMIT (Postgres treats it as unlimited).

## Recommendation

Add a realistic upper bound to qty (e.g. z.number().int().min(1).max(10000)) and consider validating totalCents stays within Number.MAX_SAFE_INTEGER; likewise clamp listOrders' limit.

## Revalidation

**Verdict:** true-positive

Confirmed: the qty check (Number.isFinite && >=1 && Number.isInteger) has no ceiling, so qty=9007199254740992 passes z.number() and the handler gate; totalCents += product.priceCents * line.qty (L201) then exceeds 2^53 for any price ≥ 2 cents, losing precision in IEEE doubles, and the corrupted total is persisted to jsonb and echoed to the caller (L212). This is reachable anonymously via public placeOrder, so order totals can be silently corrupted and nonsensical quantities accepted — a genuine logic/data-integrity bug, correctly classed as BUG rather than a security vuln given no payment provider. Minor inaccuracy: the side-note that listOrders' negative limit reaches Postgres 'treated as unlimited' is wrong (Postgres errors on negative LIMIT), but that's incidental to the core defect.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
