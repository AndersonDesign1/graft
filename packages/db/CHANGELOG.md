# @usegraft/db

## 1.0.0-beta.7

### Minor Changes

- c997e35: Content can now live in your Postgres database instead of in git. Add
  `export const content = { source: "database" }` to `graft.config.ts` and run
  `graft content import` to load your files once.

  Studio and agents then save drafts to the database, and publishing puts a
  change on the live site straight away, with no rebuild and no GitHub setup. A
  hosted Studio needs only `DATABASE_URL`. Every publish is checked exactly as
  `graft compile` checks a file (the schema, slug uniqueness and MDX safety), and
  a draft that would fail compile never goes live. `graft compile` reads the
  published versions, never the files.

  There is one draft per document, shared by everyone who edits it. Two people
  or an agent saving the same document from the same version can't overwrite
  each other: the second save gets `CONTENT_CONFLICT`. Someone without publish
  rights submits for review instead, and the request closes once everything in
  it is live.

  Git stays the default and works as before. A project uses one source or the
  other, never both. Reverting to a commit, `graft merge` and content migrations
  work on files, so in a database-sourced project they refuse with the new
  `CONTENT_SOURCE_MISMATCH`.

  `graft db migrate` adds three tables (`content_revisions`, `content_heads`,
  `content_reviews`), and `graft harden` grants the runtime role access to them.

  For code that reads review requests from a content store: `ReviewRequest` now
  has an `id`, and its `number` and `url` are optional, since a review in the
  database is not a pull request. The `review` that MCP `list_drafts` and
  `publish_drafts` return follows the same shape.

- a761a13: Moving content between the database, your files and git.

  - `graft pull` writes what is published into your files, and `graft push`
    publishes the files you changed. Graft remembers what each file was pulled
    at (`.graft/sync.json`), so a pull never overwrites your changes, and a push
    is refused with `CONTENT_CONFLICT` if someone published that document since.
    `--force` settles a conflict either way.
  - `graft dev` tells you when someone publishes, so you know your files are
    behind. Agents get the same answer from the new MCP tool `sync_status`.
  - `content.mirror` copies what is published into GitHub: in batches from
    `graft serve` (`mode: "batch"`, every `everyMinutes`), or after every publish
    (`mode: "each"`). `graft mirror` does one run. A batch is one commit, or one
    pull request merged straight away when the branch allows it. A pull request
    that waits on checks or a review stays the only one: later runs add to it
    until it merges.
  - `graft check` runs every check a publish makes on the files, with no
    database, and now also finds references to documents that don't exist.
  - `graft ci changes`, `graft ci skip-build` and `graft ci init` keep CI cheap
    on content-only changes. `skip-build` compares with the previous deploy, and
    builds when it can't tell which that was.

  For git-sourced projects hosted on GitHub, some publishes now open a pull
  request even for an editor: deletions and renames, and changes over 200 lines.
  Studio says why. Change the rule with `content.review` (`deletes`,
  `collections`, `overLines`), or turn it off with `review: false`.

  `graft db migrate` adds the `content_mirror` table.

- 2d97fda: Studio accounts: people sign in to a hosted Studio with an email and a password.

  - The first visit creates the owner account. On a server anyone can reach,
    it asks for a setup code first, which `graft serve` prints when it starts
    and `graft studio setup-code` prints from the site's settings.
  - Admins invite people from Settings, People: an email and a role make a link
    to pass on. The same list changes roles, makes a link to set a new password,
    and removes access, which signs that person out at once.
  - Account sessions live in the database, so signing out, removing someone or
    changing their role takes effect on their next request. Changing your
    password signs out your other browsers. Five wrong passwords in a row lock
    an account for 15 minutes.
  - Admins get the new `studio:people` scope. GitHub sign-in and
    `graft studio invite` links work as before.
  - New tables `studio_users`, `studio_sessions` and `studio_invites`: run
    `graft db migrate`, and `graft harden <role>` again if you use a runtime role.

- e8b55ac: Studio keeps each entry's history, puts every decision in one inbox, and
  shows what was published lately.

  - **History.** The entry's panel has a History tab. It lists every published
    version with who made it and when. Open one to see how the entry differs
    from it now, then restore it as a draft. History comes from the published
    revisions when content is in the database, the production branch's commits
    on GitHub, and the checkout's commits locally. New API routes:
    `GET /entry/history` and `GET /entry/version`.
  - **Inbox.** Changes sent for review and agents asking before a destructive
    call share one inbox, with a count in the sidebar. When content is in the
    database, someone who can publish publishes a review from there. Approvals
    move out of the Developer views, and old `#/dev/approvals` links open the
    inbox.
  - **Home.** A "Recently published" feed lists who published what, with
    links to the entries (`GET /activity`).
  - Content stores gain optional `history`, `readVersion` and `activity`
    methods. `DatabaseStore` and `GitHubStore` implement them, and
    `@usegraft/db` adds `publishedHistory`, `recentlyPublished` and
    `readPublishedRevision`.

- b086a62: Studio gets a media library, agent tokens, and the site's settings with deploy
  hooks.

  - **Media.** A Media page lists the files in the asset store that Studio
    uploaded or an entry uses. Upload, search, write alt text, see which entries
    use a file, and delete one nothing uses. Image fields have Choose…, and a gallery's Add image, which pick from the same library and take the file's alt text when the field has none. New routes under `/api/studio/v1/assets`.
  - **Agents.** Admins make a token per agent under Developer, Agents, with
    Read, Write drafts or Publish access. The token is shown once and only its
    hash is stored. `graft serve` accepts it on `/api/mcp`, the Studio API and
    functions, and revoking it takes effect on the next request. No token can
    decide approvals. `@usegraft/auth`'s resolver gains a `tokens` option for
    this.
  - **Site and deploy hooks.** Settings has the site's name and address, and
    deploy hooks: URLs called with a `POST` after every publish of
    database-sourced content, with an optional bearer secret. Each hook shows
    what it answered last, and Send a test calls it now. A failing hook never
    undoes a publish. `@usegraft/compiler` exports `fireDeployHooks`.
  - New scope `studio:settings`, held by admins.
  - A Studio route that needs a table the database doesn't have answers
    `MIGRATION_REQUIRED` (503) with the fix, instead of failing the request.

  Run `graft db migrate` (migration 0013 adds `assets`, `agent_tokens`,
  `site_settings` and `deploy_hooks`). Run `graft harden <role>` again if you
  use a runtime role.

### Patch Changes

- Updated dependencies [c997e35]
  - @usegraft/contracts@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Updated dependencies [2386e74]
  - @usegraft/contracts@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies [ab7cca3]
- Updated dependencies [ab7cca3]
  - @usegraft/contracts@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- Updated dependencies [4831a77]
  - @usegraft/contracts@1.0.0-beta.4

## 1.0.0-beta.3

### Minor Changes

- 56c0957: Concurrent `graft migrate --apply` runs apply each migration once.

  The ledger was read before a run and written after it, so two runs started
  together both saw a migration as pending and both applied it. The second then
  failed on the ledger's unique index, after its content rewrite and data updates
  had already run.

  `@usegraft/db` exports `withMigrationLock(db, branchId, work)`. It holds a
  transaction-scoped Postgres advisory lock for the branch while `work` runs.
  `graft migrate --apply` reads the ledger only once it holds the lock, so a
  second run waits for the first, then skips what the first applied.
  `graft merge --apply` takes the same lock on both branches, in a fixed order:
  it writes the target's ledger, and reads the source's, so no migration can land
  on the source while its rows move.

  The lock is transaction-scoped so it works behind a transaction-mode pooler
  such as Neon's PgBouncer. A crashed run drops its connection, which ends the
  transaction and frees the lock. There is no stale claim to clear.

  The lock's transaction pings every 10 seconds while the run works, so an
  idle-in-transaction timeout longer than that does not end it early. It needs a
  pool of at least two connections, one for the lock and one for the work, and
  refuses a smaller pool up front instead of waiting on itself.

### Patch Changes

- Updated dependencies [f92b97c]
  - @usegraft/contracts@1.0.0-beta.3

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

- Updated dependencies [15568eb]
- Updated dependencies [e2829b4]
  - @usegraft/contracts@1.0.0-beta.0

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

- 02690dd: An approval is filed pending by construction.

  Migration `0009_pending_by_construction` adds a `CHECK` on `approvals.status`
  and a `BEFORE INSERT` trigger that refuses any insert naming a status other
  than `'pending'`, or carrying a decision in `decided_by`, `decided_at`,
  `decided_role` or `decided_by_kind`.

  The column-scoped INSERT grant already stopped a hardened runtime role from
  filing an approved approval. That is a grant list, and a grant list is a thing
  someone edits. This puts the same rule in the table, so it holds for every role
  including the owner, and no future change to `runtimeRoleGrantsSql` can quietly
  reopen it.

  The trigger raises rather than coercing the row to `'pending'`. A caller trying
  to file a decision has a bug or is an attacker, and silently rewriting the row
  would hide both.

  Deciding is an `UPDATE` and is untouched.

  **Requires a migration.** Run `graft db migrate` (or
  `node packages/db/scripts/migrate.mjs`) before serving on an existing database.

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

- 52d7488: The hardened runtime role can project content, and the container hardens by
  default.

  `graft harden` denied the runtime role `INSERT`/`UPDATE` on `content_index` and
  `compilations`, so hardening cost a deployment its MCP content writes. That made
  the second layer of the approval gate something you traded a working feature
  for, which is why it was opt-in and applied to nothing.

  The denial was not buying what it looked like. `write_content` writes the MDX
  file and then compiles, and compile is the step that reaches Postgres, so
  whoever holds the runtime credential could already project content through the
  application. Withholding the grant removed a feature, not a capability.

  The property worth enforcing is narrower and untouched: no `UPDATE` on
  `approvals`, so `pending → approved` stays unreachable for the runtime even with
  raw SQL. Removals are a soft delete, so `DELETE` on `content_index` stays
  ungranted, and `migrations_applied` stays operator-only.

  **Security fix, found reviewing the above.** The `approvals` INSERT grant was
  table-level, and `status` is plain text with a `DEFAULT` rather than a `CHECK`.
  Postgres lets a table-level `INSERT` grantee name every column, so the runtime
  credential never needed to flip a pending row: it could file one that was
  already `'approved'` and consume it, and `decideApproval` (with its
  separation-of-duties predicate) would never run. Withholding `UPDATE` alone was
  not the control it read as. The grant is now column-scoped to the seven columns
  an approval request actually writes, so `status`, `decided_by`, `decided_at` and
  `decided_role` fall back to their defaults.

  This predates the changes above, but shipped dormant behind an opt-in nobody
  ran. Turning hardening on by default is what would have made it live.

  **Breaking:**

  - `runtimeRoleGrantsSql` emits two more `GRANT` statements. Re-run
    `graft harden <role>`; existing hardened roles keep working with the old,
    narrower grants until you do.
  - The all-in-one container serves under the hardened runtime role by default.
    Set `GRAFT_HARDEN=0` for the previous behaviour. `GRAFT_MODE=serve` stays
    opt-in, because there the database is yours rather than the container's.

  See `docs/adr/0005-hardening-is-the-default-where-the-container-owns-the-database.md`.

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
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
  - @usegraft/contracts@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/contracts@0.1.1

## 0.1.0

### Patch Changes

- @usegraft/contracts@0.1.0
