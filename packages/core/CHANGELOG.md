# @usegraft/core

## 1.0.0-beta.0

### Minor Changes

- 655e4d1: **BREAKING:** `@usegraft/db` is an optional peer dependency of
  `@usegraft/core` rather than a dependency.

  `db-out-of-the-browser` moved the database off sdk-core's direct dependencies,
  but only half the graph went with it. `@usegraft/core` stayed a hard dependency
  of sdk-core and kept its own hard dependency on `@usegraft/db`, so the chain
  survived one hop further out:

      sdk-react -> sdk-core -> core -> db -> postgres, drizzle-orm

  Bundling was already safe, because sdk-core imports core with `import type` and
  those erase. The install was not: `npm i @usegraft/sdk-react` still downloaded
  `postgres` and `drizzle-orm`, which is the exact complaint that fix opens with.
  cubic kept the thread open on the pull request and was right to.

  `npm i @usegraft/sdk-react` now pulls one external package, `zod`.

  Every package that reaches core's database-backed modules at runtime already
  declares `@usegraft/db` directly (`cli`, `compiler`, `mcp`, `studio`, and the
  five server adapters), so nothing needs a new dependency. The packages that
  depend on core without it — `auth`, `content-migrations`, `sdk-react` — import
  only types. If you depend on `@usegraft/core` directly and call
  `defineDataMigration`, `records`, or the functions handler, add
  `@usegraft/db` to your own dependencies.

### Patch Changes

- 2561b47: **BREAKING:** approval policy moves from `GRAFT_APPROVAL_POLICY` to
  `approvalPolicy` in `graft.config.ts`. The env var is ignored, and `graft serve`
  warns once at boot if it is still set.

  `createFunctionsHandler` has documented this setting as config-owned all along:
  "deliberately a value the operator writes in config rather than an env var,
  because turning off the gate on irreversible work should appear in a diff and a
  review." The CLI was the piece still reading an env var, so the rationale was
  written down and not enforced. This is the setting that lets `deleteRecord`
  hard-delete rows with no human in the loop, and a hosting dashboard is where
  that decision goes unreviewed. It is parsed like `mdxTrust`: an unknown value is
  refused rather than defaulted, so a typo cannot silently pick a weaker policy.

  ```ts
  // graft.config.ts
  export const approvalPolicy = "unattended";
  ```

  **An approval presented to an ungated call is now spent.** Under `"unattended"`
  the gate is skipped, and the whole block went with it, including
  `approvals.consume`. A granted row stayed `approved` and replayable: tighten the
  policy later and that row still authorized a destructive call nobody
  re-reviewed. One-shot has to survive a policy change, which is exactly when the
  stale row is dangerous. Consuming is best-effort here, because an ungated call
  must not fail on the approval store.

  **`run_function` over MCP gets the same rate-limit backstop as `POST /api/fn`.**
  `graft serve` passed `{ limit: 60, windowSeconds: 60 }` to the functions handler
  and nothing to the MCP handler, so a function with no per-function `rateLimit`
  was capped on one transport and uncapped on the other. `tools/functions.ts`
  claims both surfaces apply rate limits identically; now they do.

  **`assertSafeMdx` reports unparseable MDX as `INPUT_VALIDATION_FAILED`.**
  `UncheckableMdxError` escaped it raw, so `write_content` and a Studio save
  returned a bare `Error` where every other rejection on that path is a structured
  `GraftError` — a client could not tell malformed input from a transport fault.
  `graft compile` catches the raw error itself and is unaffected.

  All four found by cubic on the pull request.

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

- a442299: Add `approvalPolicy: "unattended"`, so a caller with no human behind it can run
  a destructive function.

  `"none"` and `"human"` both had no answer for a scheduled job or a CI
  migration. The destructive arm of the gate had no off switch at all, which is
  the absence of a policy rather than a policy: those callers could never invoke
  a destructive function, ever.

  `"unattended"` turns the gate off entirely. Everything else is unchanged —
  every invocation still writes its audit row with actor, correlation id and git
  SHA, and access rules and rate limits still apply. What is given up is the
  waiting, not the accounting.

  It is deliberately **not on the MCP surface**. `GraftMcpOptions` accepts only
  `"none"` and `"human"`, so there is no server setting that makes `run_function`
  stop asking before a destructive call. The policy exists for a caller with no
  human behind it; an MCP mount exists because an agent is calling it, and the
  agent is precisely the party the gate is there to stop. On `graft serve` that
  split is observable — the env var lifts the gate on `POST /api/fn` and leaves
  `POST /api/mcp` gated.

  `graft serve` reads it from `GRAFT_APPROVAL_POLICY=unattended` and warns on
  every boot while it is on, because an env var is one line in a dashboard and
  the log is where a mistake gets noticed.

  Worth being explicit about the trade: git restores authored content, so a
  deleted document comes back, but it does not restore operational data.
  `deleteRecord` removes rows outright and the asset store keeps no history.

- Updated dependencies [15568eb]
- Updated dependencies [e2829b4]
  - @usegraft/contracts@1.0.0-beta.0
  - @usegraft/db@1.0.0-beta.0

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

- e0d4eda: Field builders can bound what they accept, and query limits are clamped
  server-side.

  `FieldOptions` carried only `optional` and `description`, so every authored
  string and every public form input compiled to a bare `z.string()` and was
  written verbatim into an unbounded jsonb column. A single anonymous request
  could store megabytes; an unbounded quantity multiplied by a price silently
  exceeded `Number.MAX_SAFE_INTEGER` and stored a wrong total rather than being
  rejected.

  **New options:** `maxLength` (string/text), `min` / `max` / `int` (number),
  `pattern` (string/text), and `maxItems` on `field.array`.

  **Breaking:**

  - `listRecords` clamps `limit` to `MAX_RECORD_LIMIT` (500) and coerces nonsense
    values to the default. It previously passed a caller-supplied number straight
    to `LIMIT`, so a public query could ask for a billion rows — or a negative
    one, which made Postgres error.
  - `listRecords` gains `match`, which filters on `data` fields **in SQL**.
    Filtering after the row cap is a correctness bug, not just a slow path:
    non-matching rows still consume the window. `listComments` filtered
    `approved && pageSlug` in JavaScript afterwards, so posting enough unapproved
    comments emptied every approved comment on every page, silently.

  The bundled `comments` and `commerce` primitives now bound every input,
  `placeOrder` caps `items` at 100, and `loadProducts` batches the catalog lookup
  into one `inArray` query instead of one round-trip per slug — that loop ran
  _before_ unknown slugs were rejected, so a request full of bogus slugs held a
  pooled connection for thousands of serial queries and only then failed
  validation.

  `products.currency` is constrained to three letters, so one malformed product
  can no longer take down the catalog page via `Intl.NumberFormat`.

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

### Patch Changes

- d6cbc3d: Thirteen self-contained defects, led by a data-loss bug in the editor.

  - **The editor wrote one document's content into another document's file.**
    `persist` took `collection`/`slug` from the current route closure while taking
    the bytes from a ref. On an A → B navigation React re-renders with route=B
    before the pending flush runs, so A's edits were written to B's path,
    destroying it — and the toast said "Saved B/B". Identity now comes from the
    same snapshot as the content, via a new `buildSavePayload` that takes it as an
    argument, which makes the mismatch unrepresentable. Document loads are
    sequenced so out-of-order responses cannot show one document under another's
    route.
  - `updateRecord` read, merged and wrote with no lock, so two concurrent callers
    both merged over the same baseline and the second silently erased the first.
    Now one transaction with `SELECT … FOR UPDATE`, and the "unreachable"
    `throw new Error` is a real `DOCUMENT_NOT_FOUND`.
  - A malformed URL escape white-screened the Studio (`parseHash` runs in a
    `useState` initialiser, so the `URIError` threw during first render) and
    turned Studio asset and route-id requests into misleading 500s.
  - The compiled static index briefly did not exist: `rmSync` then `renameSync`
    left a window where readers got `STATIC_INDEX_NOT_FOUND`, and a crash between
    them destroyed the artifact. Now an atomic rename, falling back only on
    Windows.
  - Data migrations persisted the raw transform output instead of the validated
    result, so Zod defaults and coercions never reached the stored rows, and
    compared with key-order-sensitive `JSON.stringify` against jsonb that
    normalises key order — rewriting identical rows.
  - The generated `graft/index.ts` barrel emitted duplicate imports when two
    filenames collapsed onto one identifier (`my-mod.ts` and `myMod.ts`), in a
    file marked "do not edit". It now refuses and names both offenders.
  - `graft dev` kept watching the original content directory after a config reload
    moved it, so every later save was invisible.
  - OIDC tokens without a `sub` claim authenticated as an actor with no id.
    `requiredClaims: ["sub"]` now rejects them.
  - `applyPlan` trusted a conflict snapshot taken when the plan was built; it now
    re-checks disk immediately before each write.
  - A `??` chain in the pages-description migration short-circuited on an empty
    string, so the documented title fallback was never reached.
  - All four GitHub Actions are pinned to commit SHAs, and the release workflow's
    `id-token: write` is scoped to the publish job rather than the whole file.

- Updated dependencies [61b9ac4]
- Updated dependencies [02690dd]
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
- Updated dependencies [52d7488]
- Updated dependencies [d6cbc3d]
  - @usegraft/contracts@0.2.0
  - @usegraft/db@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/contracts@0.1.1
- @usegraft/db@0.1.1

## 0.1.0

### Minor Changes

- 8d8eda0: Initial public release of the Graft packages: contracts, core, db, assets,
  compiler, content-migrations, auth, sdk-core, sdk-next, sdk-astro,
  sdk-sveltekit, cli, mcp, registry, studio, tokens. All packages version
  together (fixed group) while pre-1.0.

### Patch Changes

- @usegraft/contracts@0.1.0
- @usegraft/db@0.1.0
