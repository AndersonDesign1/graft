# [MEDIUM] Open registration plus blanket scope grant exposes contact-form PII and lets any user rewrite order statuses

**File:** [`examples/landing-page/lib/auth.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/lib/auth.ts#L21-L33) (lines 21, 33)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `acl-check`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

lib/auth.ts configures Better Auth with `emailAndPassword: { enabled: true }` (L21), which enables unauthenticated self-registration via POST /api/auth/sign-up/email through the public catch-all mount in app/api/auth/[...all]/route.ts, with no email-verification requirement. Simultaneously, the JWT definePayload hook (L29-L34) stamps EVERY newly registered account with the scope claim "submissions:read commerce:orders:read commerce:orders:write" (L33). Because packages/auth/src/scopes.ts requireScopes() accepts any actor whose token carries the scope, an attacker needs zero privileges beyond one free signup to: (1) mint a JWT at GET /api/auth/token, (2) call listSubmissions/searchSubmissions and dump all contact-form submissions including submitter email addresses and message bodies (PII disclosure), (3) call listOrders and read all customer order data (emails, items, totals), and (4) call updateOrderStatus to set arbitrary orders to paid/fulfilled/cancelled — corrupting e-commerce state without payment. Verified end-to-end: the scope claim flows through oidc.readScopes() into actor.scopes, and createFunctionsHandler enforces exactly these gates. The code comments acknowledge this is an 'example-sized policy' (real deployments derive scopes from roles), which lowers confidence that it is unintended, but the example is deployable as-is and copies of it inherit the flaw. Note the more dangerous scopes (submissions:admin, content:moderate) are correctly reserved for the dev token only.

## Recommendation

Derive scopes from a role/group claim instead of granting them to every authenticated principal (e.g., check user.role === 'admin' inside definePayload and emit an empty scope otherwise), require email verification before minting scoped tokens, and/or disable open signup (disableSignUp) so accounts are provisioned by an operator.

## Revalidation

**Verdict:** true-positive

Every link in the chain checks out in source. lib/auth.ts L21 enables email+password auth, which turns on Better Auth's unauthenticated POST /api/auth/sign-up/email through the public catch-all mount (app/api/auth/[...all]/route.ts exports auth.handler for GET+POST); grep confirms no disableSignUp, no email-verification requirement, and no Next.js middleware anywhere in the example. L33 stamps EVERY account's JWT with 'submissions:read commerce:orders:read commerce:orders:write'; lib/actor.ts trusts this issuer via betterAuthIssuer, packages/auth/src/oidc.ts readScopes() parses the space-separated scope claim into actor.scopes, and packages/auth/src/scopes.ts requireScopes() admits any non-anonymous actor holding the scope. Concrete attack: sign up free, GET /api/auth/token with the session cookie, then Bearer-call listSubmissions/searchSubmissions (dump all submitter emails + message bodies), listOrders (all customer order data), and updateOrderStatus — which is NOT destructive:true, so under the default approvalPolicy 'none' createFunctionsHandler applies no human gate, allowing arbitrary paid/fulfilled/cancelled transitions without payment. The in-code 'example-sized policy' comments show awareness, and the known-false-positive exemption covers only GRAFT_DEV_TOKEN bootstrap (not this policy), so the finding stands: the example is deployable as-is and copies inherit the over-grant. MEDIUM fits given PII disclosure plus e-commerce state corruption scoped to example deployments.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
