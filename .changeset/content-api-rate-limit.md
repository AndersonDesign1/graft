---
"@usegraft/content-api": patch
"@usegraft/contracts": patch
"@usegraft/core": patch
"@usegraft/cli": patch
---

Rate-limit the content API, and give `graft serve` the same backstop there it
already gave functions.

`graft serve` passed `rateLimit: { limit: 60, windowSeconds: 60 }` to
`createFunctionsHandler` and nothing to `createContentApiHandler`, which had no
such option to pass. Greptile demonstrated the consequence on the pull request
by running it: 61 requests to `/api/content/v1/documents`, 61 responses of
`200`, no `Retry-After` on the last one. These routes authenticate nobody and
run database listings and full-text searches, so one anonymous caller could
keep the index busy for as long as it liked.

`createContentApiHandler` now takes `rateLimit` and `trustedProxyHops`.
Omitting `rateLimit` means unlimited, which stays correct for a handler mounted
behind something that already limits. `graft serve` passes the same 60 per 60
seconds it gives functions.

The counter is in memory rather than in the audit table. The function limiter
counts rows it is already writing; these are reads that write nothing, and
adding a write per read to enforce a read limit inverts the cost of the thing
being protected. Two honest consequences, both documented: it is per process,
so N replicas allow N times the limit and a restart resets it; and it is a
fixed window where functions get a rolling one. A deployment needing an exact
global limit puts it in the proxy already terminating TLS.

The check runs before the index is touched, and after method and route
validation. Both halves are tested: a limit that fires once the query has
already run protects nothing, and charging a `405` to the bucket would let
someone probing with the wrong method spend the shared anonymous budget.

**The caller-identity rule is now shared rather than copied.** `rateIdentity`
and the peer registry move from `@usegraft/core` to `@usegraft/contracts`,
which both packages already depend on, and `@usegraft/core` re-exports them so
`setRequestPeer` keeps resolving where callers already import it. That rule —
never read `x-forwarded-for` unless the deployment declares its proxy depth,
then count from the right — is listed in `.greptile/rules.md` as a security
invariant precisely because the obvious implementation is the wrong one, and
two copies of it is how a future fix lands in only one.

Also documents what was true before this change and unwritten: the content API
performs no authentication at all, so its `collections` list is a security
boundary rather than a convenience, and `graft serve` registers every
collection in the config.
