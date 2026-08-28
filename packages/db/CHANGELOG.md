# @usegraft/db

## 0.2.1

### Patch Changes

- @usegraft/contracts@0.2.1

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
