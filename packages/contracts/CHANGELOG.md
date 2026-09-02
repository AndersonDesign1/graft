# @usegraft/contracts

## 1.0.0-beta.1

### Patch Changes

- 27b8468: Dependency floors raised to versions without known advisories.

  `main` was carrying 34 Dependabot alerts, and a range-respecting update across
  the workspace clears 23 of them: `next` 16.2.9 → 16.3.3 (nine alerts on its
  own), `hono` 4.12.27 → 4.13.5, `postcss` 8.4.31 → 8.5.23, plus `astro`, `tar`,
  `sharp`, `svgo`, `@astrojs/vercel` and `@hono/node-server`.

  Declared ranges move with the lockfile, which is what makes this a change worth
  a version rather than a lockfile refresh: `zod` `^4.1.0` → `^4.5.4`, `jose`
  `^6.0.0` → `^6.2.10`, `jiti` `^2.4.0` → `^2.7.0` and the React type packages.
  Every one is a floor raised inside the same major. **No peer range changed** —
  `sdk-next` still peers `next >=15.0.0`, `sdk-react` still peers `react >=18.0.0`
  — so nothing a consumer already resolves stops resolving.

  Eleven alerts survive this and are deliberately not addressed here. Two are
  `vitest`, pinned at `^2.1.9` against a fix in `3.2.6`: a major upgrade of the
  test framework is its own change, not a line in a dependency bump. The other
  nine are transitive versions their parents pin — `esbuild` now resolves
  `0.28.1` and `0.28.2` alongside `0.18.20`, `0.21.5`, `0.25.12` and `0.27.7`,
  and only `pnpm.overrides` dislodges those. Each override is a compatibility bet
  and belongs where it can be argued one at a time.

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

## 1.0.0-beta.0

### Minor Changes

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

## 0.2.0

### Minor Changes

- 61b9ac4: Approval decisions are attributed to a verified identity, never to caller input.

  `decideApproval` took a `decidedBy: string` that every surface let the caller
  supply. That string is the entire separation-of-duties control — the UPDATE's
  WHERE clause compares it against `requested_by_id` — so anyone who could name it
  could approve their own destructive operation by naming somebody else. The
  guard was decorative.

  **Breaking:**

  - `decideApproval(db, id, decision, decidedBy)` now takes an `ApprovalDecider`
    (`{ kind, id }`) instead of a string.
  - The MCP `decide_approval` tool no longer accepts a `decidedBy` argument. It
    attributes the decision to the identity the connection authenticated as, via
    the new `connectionActor` option, and refuses an unauthenticated connection.
  - `POST /api/studio/v1/approvals/{id}/decide` ignores `decidedBy` in the body;
    the Studio's `decidedBy` mount option is now `decider: ApprovalDecider`.
  - An approval whose requester has no stable id is **undecidable**
    (`APPROVAL_UNATTRIBUTED`). The old `requested_by_id IS NULL` arm made those
    approvable by anyone, including whoever filed them.
  - A human-gated function called by an actor with no stable id is refused with
    `UNAUTHORIZED` instead of filing an approval nobody can be accountable for.

  Adds a `decided_by_kind` column (migration `0008`) so attribution records what
  kind of actor decided, matching `requested_by_kind`.

- f423a6e: Every package ships a README, a description, keywords and a LICENSE.

  `0.1.1` published sixteen packages with no README and, for fourteen of them, no
  `description` either. On npm that renders as a blank page and an unsearchable
  listing: `description` is the line npm search shows, and without keywords the
  packages are findable only by exact name.

  Each README says what the package is, how to install it, and shows one real
  example using its actual exports. The security-relevant ones state their
  defaults plainly, because "MdxBody refuses executable MDX by default" is
  something a reader should not have to find in an ADR.

  `LICENSE` is now copied into each package. `files: ["dist"]` does not exclude
  `README.md` or `LICENSE` (npm always packs those), but a licence file only ships
  if it exists in the package directory, and the root one does not count.

- ed103a8: Rate limits key on the real peer address, and concurrency can no longer outrun
  them.

  Every rate limit in the product was bypassable with a header.
  `clientIp` read `x-forwarded-for.split(",")[0]` — the **leftmost** entry, which
  under XFF's append semantics is whatever the original client wrote. Rotating the
  header minted a fresh bucket per request, defeating per-function limits, the
  handler-wide backstop, and the anti-brute-force property they exist for.

  Separately the limiter counted prior audit rows, ran the handler, and recorded
  its row afterwards — a window spanning the entire invocation. N concurrent
  requests all read the same count, all saw room, and all ran.

  **Breaking:**

  - `AuditStore.record(entry)` is replaced by `reserve(entry) => id` and
    `settle(id, outcome)`. The row is inserted before the call is admitted, so the
    counter and the evidence are the same row. A row left `in_flight` is a crashed
    or still-running invocation, which is worth being able to see.
  - `FunctionsHandlerOptions.trustedProxyHops` (default `0`) controls whether
    `x-forwarded-for` is read at all. At `0` it is ignored entirely. At `n`, the
    nth entry **from the right** is used — the address your own nearest proxy
    observed, which a client cannot forge past. Set it to the number of proxies
    you run.
  - `runtimeRoleGrantsSql` grants `UPDATE (status, duration_ms) ON audit_log`.
    Column-scoped deliberately: the runtime may record how a call ended, never
    rewrite who made it or what it counted against.

  `PEER_HEADER` (`x-graft-peer`) is exported from `@usegraft/contracts`. Graft's
  Node adapter strips any inbound copy and sets it from the socket, so unlike
  `x-forwarded-for` it cannot be written by a client.

- 301c817: Fixes found by independent review of the hardening work itself.

  - **The rate-limit peer is no longer a header.** `x-graft-peer` was stripped and
    re-set by Graft's Node adapter, which is sound for `graft serve` and worthless
    in a Next.js or Astro route that passes the browser's Request through
    untouched — a client could send the header and choose its own bucket. That is
    the `x-forwarded-for` bug, relocated to a header nobody knew they had to
    strip. The peer is now registered against the Request object in-process
    (`setRequestPeer` / `getRequestPeer`), which nothing over the wire can forge.
    `PEER_HEADER` is removed. Deployments with no adapter share one `unknown`
    bucket unless they declare `trustedProxyHops`; both examples now do.
  - **`@usegraft/mdx-safety` parses what the renderer parses, and fails closed.**
    The checker used `remark-parse` + `remark-mdx` while `MdxBody` compiles with
    `remark-gfm` — so source that failed to parse here but compiled there was
    waved through by the old "unparseable means nothing to execute" shortcut. GFM
    is now enabled on both sides, and unparseable source throws
    `UncheckableMdxError` instead of returning `[]`.
  - **Scripting elements and inline event handlers are refused.**
    `<script>alert(1)</script>` and `<img onerror="…">` contain no `{}`
    expression, so the expression checks never saw them. The module now documents
    that it is not a general HTML sanitiser.
  - **`createGraftMcp` fails closed when `actor` is set without `connectionActor`.**
    That combination silently disabled every MCP write-tool scope check, and it
    shipped in one of our own example scripts.

## 0.1.1

## 0.1.0
