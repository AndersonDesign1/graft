# [MEDIUM] Anonymous rate limit for public placeOrder is keyed on spoofable X-Forwarded-For

**File:** [`packages/registry/registry/commerce/graft/commerce.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/registry/commerce/graft/commerce.ts#L127) (lines 127)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `rate-limit-bypass`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

placeOrder's declared control is '10/min per caller' (rateLimit at L127). In createFunctionsHandler (packages/core/src/functions-handler.ts), clientIp() resolves the anonymous rate identity from `request.headers.get("x-forwarded-for").split(",")[0]` — the FIRST entry, which is client-supplied whenever an intermediary proxy appends to the header (the standard behavior). An attacker rotating X-Forwarded-For values gets a fresh `ip:<value>` rate bucket per request, fully bypassing the limit. This removes the only throttle on the public ordering endpoint, amplifying the unbounded-items DoS above and allowing unbounded pending-order spam into the orders collection.

## Recommendation

Use the last XFF entry or socket address, or make the trusted-proxy hop count configurable; alternatively key anonymous limits on a connection-level IP injected by the platform rather than a client-readable header.

## Revalidation

**Verdict:** true-positive

Verified precisely: functions-handler.ts clientIp() returns forwarded.split(",")[0] — the FIRST XFF entry — and the anonymous rateKey is ip:<that value>; the package's own test locks in this behavior. Under standard reverse-proxy append semantics the first entry is the attacker-supplied original value, so rotating the header mints a fresh bucket per request and fully defeats the 10/min control on public placeOrder; when directly exposed the header is entirely attacker-chosen too. Only platforms that overwrite XFF with the real client IP mitigate it. This removes the sole throttle on an anonymous ordering endpoint, enabling pending-order spam into data_records and amplifying F9. Topology-dependent but objectively a broken trust boundary in the framework code; medium confidence and MEDIUM severity are both correct.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
