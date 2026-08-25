# [BUG] Unvalidated currency code passed to Intl.NumberFormat can crash the catalog page

**File:** [`examples/landing-page/app/products/page.tsx`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/app/products/page.tsx#L14-L39) (lines 14, 39)
**Project:** graft
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-unvalidated-render-input`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

formatPrice() forwards the product frontmatter's optional `currency` string directly into new Intl.NumberFormat("en-US", { style: "currency", currency }). Per ECMA-402, Intl throws a RangeError when the currency argument is not exactly three ASCII letters. The products collection schema declares currency as a free-form optional field.string (packages/registry/registry/commerce/graft/commerce.ts) with no format constraint, so an authored product with e.g. `currency: "US"` or "dollars" compiles fine but throws during server render of app/products/page.tsx, taking down the entire catalog page (no error boundary). Exploitability is limited: the value originates from git-authored MDX compiled by trusted authors/agents, not from anonymous HTTP input, so this is a robustness bug rather than a security vulnerability. All other rendered fields (title, description, MDX body) go through React escaping / the documented content-as-code MDX pipeline and are not attacker-controllable beyond repo-write trust.

## Recommendation

Validate currency against /^[A-Za-z]{3}$/ in the collection schema (custom Zod refine) or guard formatPrice with a try/catch fallback to a plain numeric format so one malformed document cannot break the page.

## Revalidation

**Verdict:** true-positive

Confirmed end-to-end. The products collection schema (registry/commerce/graft/commerce.ts:46-49) declares currency as optional free-form field.string with no format constraint, so authored frontmatter like `currency: US` or `currency: dollars` passes compile-time validation. page.tsx formatPrice() forwards it directly into new Intl.NumberFormat('en-US', { style: 'currency', currency }); per ECMA-402 IsWellFormedCurrencyCode, any value that is not exactly three ASCII letters throws a RangeError at construction. There is no try/catch, no error boundary, and dynamic = 'force-dynamic' means the throw happens during server render, failing the /products route with a 500 — one malformed document breaks the entire catalog page. The OrderForm mapping at line ~48 propagates the same value client-side. As the finding itself states, the input originates from git-authored MDX (repo-write trust: authors or agents), not anonymous HTTP, so this is a robustness/availability bug within a legitimate authoring flow rather than a remotely exploitable vulnerability — exactly matching its BUG classification. The defect is real, deterministic, and reachable through normal operation.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
