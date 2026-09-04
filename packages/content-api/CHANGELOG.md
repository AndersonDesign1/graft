# @usegraft/content-api

## 1.0.0-beta.2

### Patch Changes

- @usegraft/contracts@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- 52fc3e6: Install commands drop `@beta`. A plain install is now the right install.

  Every README said `npm i @usegraft/<pkg>@beta`, because `latest` pointed at
  `0.2.0` while the docs described `1.0.0-beta.x`. Writing the tag into 22 files
  treated the symptom. The defect was the dist-tag: `latest` is what a bare
  install resolves, and it resolved to somewhere nobody should land.

  `latest` now points at the prerelease across all 21 published packages, and the
  `0.x` line is deprecated, so the tag has nothing left to do. `install-tag.mjs`
  inverts with it — it strips tags instead of adding them, and CI fails if one
  comes back.

  The half a script cannot check is the registry. Publishing a prerelease while
  `latest` sits on something older reopens the original bug and nothing in the
  repo will notice. That property is kept by moving the tag at release, and it is
  written down in the script rather than assumed.

- Updated dependencies [27b8468]
- Updated dependencies [52fc3e6]
  - @usegraft/contracts@1.0.0-beta.1

## 1.0.0-beta.0

### Minor Changes

- d5f5567: Let the content API be read from a browser on another origin.

  `@usegraft/sdk-react` reads over HTTP from a browser, and the handler sent no
  CORS headers at all — so unless the app and the content API shared an origin,
  every read was blocked by the browser. That is the ordinary deployment for the
  browser client, which made it largely unusable as shipped. cubic raised it on
  the pull request.

  `createContentApiHandler` takes `allowedOrigins`: a list, or `"*"`. Omitted
  means no CORS headers and same-origin only, which stays the default because
  publishing an endpoint to other origins is the deployer's decision rather than
  a library's. `graft serve` reads `GRAFT_CONTENT_ALLOWED_ORIGINS` (comma
  separated, or `*`).

  Details that are easy to get wrong and are tested:

  - An allowed origin is echoed with `Vary: Origin`. Without `Vary`, a shared
    cache can hand one origin the response it stored for another and the
    allowlist stops meaning anything.
  - A disallowed origin gets an ordinary response with no CORS header, not a
    refusal. The browser enforces it; answering differently would turn the
    allowlist into an origin oracle for non-browser callers, who are not bound by
    CORS in the first place.
  - `OPTIONS` preflight is answered before method validation and before the rate
    limiter, so a browser asking permission is neither a `405` nor a charge
    against the budget for the read it precedes.
  - Error responses carry the headers too, or the browser hides the body and a
    developer debugging a `400` sees an opaque network failure instead of the
    `fix` this API took care to send.

- e2829b4: **BREAKING:** `createClient` takes `index` and no longer takes `db`. Pass a
  Postgres handle to `createDbClient` from the new `@usegraft/sdk-core/db` entry
  point instead. Every framework adapter's `createGraft` still takes either shape,
  so app code that used an adapter is unaffected.

  `npm i @usegraft/sdk-react` installed `postgres` and `drizzle-orm`. cubic
  flagged it on the pull request and it was worse than a stray manifest entry:
  `sdk-core/src/client.ts` imported `createDbIndexReader` from `@usegraft/db` for
  its **value**, so the database package was reachable code, not a tree-shakeable
  type import — in a package whose stated premise is that a database handle never
  reaches the browser. The README and `/docs/sdk-reference` both made that claim
  while the dependency graph contradicted it.

  The runtime edge now lives in `@usegraft/sdk-core/db`, and `@usegraft/db` is an
  **optional peer dependency** of `sdk-core`. A server adapter declares it
  outright and resolves it; a browser install never pulls it. The five server
  adapters gained it as a direct dependency, which is honest — they always did
  need it.

  **The type edge had to move too, or the fix would only have been half true.**
  `ClientOptions` referenced `Database`, and `ContentRow` was
  `typeof contentIndex.$inferSelect` — derived from a Drizzle table — so any
  package that merely wanted to _describe_ a row had to install a database driver
  to name the type. `ContentRow`, `ContentIndexReader`, `ReaderReadOptions`,
  `ReaderSearchOptions`, `ContentSearchHit` and `ChangeSet` now live in
  `@usegraft/contracts`, the layer every package already shares.

  `@usegraft/db` re-exports all six, so existing imports keep resolving, and its
  table now _proves_ it still matches the published contract instead of defining
  it — a compile-time assignment that fails if a column changes type. The
  dependency runs the right way round now: the seam owns the shape and the
  implementation conforms to it.

  `@usegraft/content-api` drops `@usegraft/db` entirely; its imports were always
  type-only.

  Two smaller fixes fall out of the same review. `@usegraft/sdk-react` now refuses
  a **per-read** `branch` on an endpoint-backed handle, not just one passed to the
  constructor: the content API pins its branch server-side and rejects the query
  param, so `getContent(c, s, { branch })` silently read main while the caller
  believed they were reading a preview. And the three read helpers are `async`, so
  that refusal arrives as a rejection rather than a synchronous throw from a
  function declared to return a promise — the kind a caller handling errors with
  `.catch()` never sees. An index-backed handle is unaffected, which is tested,
  because that is the one configuration where a branch is meaningful.

- 655e4d1: Let `endpoint` be a same-origin path, which is what the docs already tell you
  to write.

  `createGraft({ endpoint: "/api/content/v1" })` threw `TypeError: Invalid URL`
  before a single read. `normalizeEndpoint` called bare `new URL(endpoint)` with
  no base, and a relative path has no origin to parse against.

  That form is not a stray idea — it is the example in
  `/docs/reading-content` and in the `createGraft` JSDoc that ships inside
  `@usegraft/sdk-react`. So the first thing a browser reader copied out of the
  documentation crashed at construction. cubic raised it on the pull request.

  A string endpoint now resolves against `location.href` when one exists. An
  absolute endpoint is unchanged, and a `URL` instance is unchanged. Outside a
  browser there is no origin to resolve against, and guessing one would send
  content reads somewhere arbitrary, so a relative path there is refused as
  `CONFIG_INVALID` with that reason rather than a bare `TypeError`.

### Patch Changes

- 15568eb: Rate-limit the content API, and give `graft serve` the same backstop there it
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

- 1139a88: Add a versioned, read-only authored-content HTTP API and a remote
  `ContentIndexReader`. `graft serve` now mounts document reads and search at
  `/api/content/v1`, fixed to the server's resolved branch.
- Updated dependencies [15568eb]
- Updated dependencies [e2829b4]
  - @usegraft/contracts@1.0.0-beta.0
