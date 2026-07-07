# Copy-on-write branching (Spike B findings)

Hand-off from the Phase 1 spike to the real `@graft/db` branching abstraction.

## Question

How do we give every preview branch its own **isolated** view of operational data,
ideally **instantly** (no O(data) copy), on both managed and self-hosted Postgres?

## What was tested

`spikes/spike-b.mjs` (throwaway) compared two strategies on local Postgres 18.

### Strategy 1 — `branch_id` overlay (row-level copy-on-write) ✅ recommended self-host default

One table, a `branch_id` discriminator, and overlay reads (branch rows win over `main`,
`deleted` tombstones hide rows).

- **Instant branch:** 0.004 ms — creating a branch copies **nothing**.
- **Space-efficient:** the branch stored only the **3 changed rows**; everything else is
  read from `main`. True row-level CoW.
- **Isolated:** the `main` view was completely unaffected by the branch's edits/adds/deletes.
- **Cost:** every read needs overlay logic
  (`DISTINCT ON (collection, slug) … WHERE branch_id IN (<ancestor chain>) ORDER BY … (branch_id = $branch) DESC`).
  This must be **encapsulated in the query layer** so callers never hand-write it.
  Requires an index on `(collection, slug, branch_id)`; deletes are tombstones; merge is custom.

### Strategy 2 — schema clone (full copy) ⚠ avoid as primary

Per-branch schema with `CREATE TABLE (LIKE … INCLUDING ALL)` + `INSERT … SELECT`.

- **O(data):** 42.6 ms to clone just **3 rows** — grows with table size; not instant.
- **Sequence gotcha (confirmed):** branch insert got `id=4`, main insert got `id=5` — the
  cloned `serial` column's `DEFAULT` still points at the **parent's** sequence, so branch
  IDs are **not isolated**. Would require recreating per-branch sequences (or `IDENTITY` +
  `setval`) for every serial/identity column.

## Failure catalog (self-host)

| Concern        | branch_id overlay           | schema clone                                              |
| -------------- | --------------------------- | --------------------------------------------------------- |
| Sequences      | N/A (no per-branch serials) | **Shared via `serial` DEFAULT** — must rebuild per branch |
| Extensions     | global, unaffected          | schema-scoped objects need care; `search_path` per branch |
| Roles / grants | unaffected                  | not copied by `LIKE`; must re-grant                       |
| Pooling        | one connection set          | per-branch `search_path` must be set on every checkout    |
| Copy cost      | none (deltas only)          | O(data) per branch                                        |

## Decision — ✅ GO

- **Cloud default: Neon-style storage copy-on-write.** Instant branches, real isolation
  (including sequences), no app-level overlay. **✅ VALIDATED live 2026-07-07** — see
  "Live Neon CoW validation" below for measurements.
- **Self-host fallback: `branch_id` overlay (Strategy 1).** Instant, space-efficient,
  isolated. Accept the read-overlay complexity and hide it entirely inside `@graft/db`.
- **Schema clone is not the primary path** — keep only as an option for small datasets;
  the sequence entanglement + O(data) cost rule it out at scale.

## Implications for `@graft/db`

1. A branching abstraction with two backends behind one interface: `neon` (storage CoW)
   and `overlay` (branch_id). The query layer is written **once** against the abstraction.
2. Every operational table carries `branch_id` + `deleted`; the overlay query and
   ancestor-chain resolution live in one place.
3. Merge = apply a branch's delta rows onto the target branch (+ run migrations); design in Phase 3–4.

---

# Phase 4 hand-off — the branch-handle abstraction (decided 2026-07-06)

Phase 3 is closed; the schema is already branch-ready (every operational table carries
`branch_id` default `'main'` + uuid keys; see `packages/db/src/schema.ts`). What is **not**
built: a branch registry, ancestor-chain overlay resolution, and per-branch endpoint
routing. Today every read/write scopes by **exact match** (`eq(branch_id, $branch)`), which
is correct for `main` but is _not_ copy-on-write — a fresh branch would see zero rows, not
its parent's. This section locks the seam so the next unit can implement it without
re-litigating the shape (the P3.1 pattern: lock the interface before writing against it).

## The fork that drives the design

`createDb(url)` is **single-URL**. That is exactly where the two backends split:

|               | `overlay` (self-host default)            | `neon` (cloud default)                                     |
| ------------- | ---------------------------------------- | ---------------------------------------------------------- |
| A branch is…  | a `branch_id` + a parent pointer         | a physically separate Postgres (its own compute endpoint)  |
| Connection    | **shared** `DATABASE_URL`                | **different URL per branch** (Neon API mints the endpoint) |
| Isolation     | logical (overlay reads, tombstone hides) | physical (storage CoW — incl. sequences)                   |
| Query scoping | `branch_id = ANY(chain)` + overlay pick  | **none** — each branch DB holds only its own rows          |
| Create cost   | 0 ms (insert a registry row)             | ~instant (Neon storage CoW), one API call                  |
| Validated     | ✅ Spike B                               | ✅ **live 2026-07-07** (see below)                         |

So a branch handle can't just be "a `Database`". It is **a `Database` + a scoping strategy**.
That is the whole abstraction:

```ts
// @graft/db — the seam every read/write goes through in Phase 4.
type BranchScope =
  | { kind: "overlay"; chain: string[]; writeBranch: string } // chain leaf-first
  | { kind: "physical" }; // neon: no WHERE scoping

interface BranchHandle {
  name: string;
  db: Database; // shared handle (overlay) or the branch's own handle (neon)
  scope: BranchScope; // how queries filter; overlay callers NEVER hand-write this
  close(): Promise<void>;
}

interface BranchBackend {
  resolve(name: string): Promise<BranchHandle>; // name → handle to run against
  create(name: string, from: string): Promise<void>; // graft branch
  drop(name: string): Promise<void>;
  list(): Promise<BranchMeta[]>;
}
```

`resolve()` is the one function the SDK, compiler, and function runtime call. Overlay returns
the shared `db` + the resolved ancestor chain; neon returns a per-branch `db` + `physical`.
Callers stay backend-agnostic.

## Branch registry (control plane)

A `branches` table lives on the **control DB** (`main`), the source of truth for topology:

```
branches(
  name          text primary key,
  parent        text references branches(name),   -- null only for 'main'
  backend       text not null,                     -- 'overlay' | 'neon'
  endpoint_host text,                              -- neon: branch compute host; null for overlay
  neon_branch_id text,                             -- neon: API handle for reset/drop; null for overlay
  status        text not null default 'active',
  created_at    timestamptz not null default now()
)
```

- **Ancestor chain** = recursive walk `parent → … → main`, leaf-first (drives overlay priority).
- **Neon URL** = parent's role+password (Neon branches inherit roles) with `endpoint_host`
  swapped in. Store the **host, never the secret**; the password comes from the configured
  `DATABASE_URL`/secret at resolve time.

## The overlay read (encapsulated once, per Spike B's warning)

```sql
SELECT * FROM (
  SELECT DISTINCT ON (collection, slug) *
  FROM content_index
  WHERE branch_id = ANY($chain)                       -- ['preview/x','main']
  ORDER BY collection, slug,
           array_position($chain, branch_id)          -- leaf wins over ancestors
) picked
WHERE deleted = false;                                 -- a branch tombstone hides a live parent row
```

Writes stamp `scope.writeBranch` (the branch's own id) — **never** a parent's. `data_records`
gets the identical treatment. `neon` runs both unscoped. This lands as branch-aware read
helpers in `@graft/db` that the current `eq(branch_id, …)` call sites migrate onto; no caller
outside `@graft/db` ever writes overlay SQL.

_Gotcha to handle:_ `projectBranchContent`'s pre-write diff currently reads only the branch's
own rows, so the **first** compile on a fresh overlay branch sees everything as "added" and
copies-on-first-write. Either diff against the overlaid parent view or accept (and document)
copy-on-first-write. Decide when implementing.

## Merge = git recompile + data deltas (the key simplification)

Content is **git-authoritative** (top invariant). So merging _content_ is not a row-level DB
merge — it's a **git** merge of the authored files + a **recompile** of the target's
`content_index` (which is derived, and already atomic). Only **`data_records`** — operational,
Postgres-owned — needs a true row-level merge. `graft merge <branch> [--into main]` therefore:

1. **Replay the ledger:** apply migrations in `migrations_applied` present on the branch but
   not the target (the table built in P3.6 exists for exactly this).
2. **Apply data deltas:** fold the branch's `data_records` inserts/updates/tombstones since
   fork onto the target (overlay: rewrite `branch_id`; neon: diff branch DB → target).
3. **Recompile content:** project the merged git tree into the target — content needs no
   row-merge, just re-derivation.

This keeps the scary part (row-level merge) confined to the one table that genuinely owns its
data, and reuses the migration ledger + projection engine already shipped.

## Cache-invalidation contract (sdk-core / sdk-next)

The projection already emits a `ChangeSet` (added/changed/removed) — the invalidation input,
by design (a4ec83d). Phase 4 turns it into cache tags:

- Tag scheme: `graft:{branch}:{collection}:{slug}` per doc + `graft:{branch}:{collection}` per
  list. `sdk-core` exposes `tagsFor(branch, collection, slug?)`; RSC reads register those tags.
- After every compile, `sdk-next` calls `revalidateTag` over the `ChangeSet` — deferred here
  from P2 on purpose. `subscribe`/SWR for live previews layer on top.

## Live Neon CoW validation — ✅ PASSED (2026-07-07)

Ran `spikes/spike-neon-cow.mjs` (throwaway) against the Frankfurt project
(`dark-pine-91155521`, pg18) with a `NEON_API_KEY`. All three questions answered yes:

1. **Distinct endpoint, inherited role.** `POST /projects/{id}/branches` with
   `endpoints: [{ type: "read_write" }]` returned a new branch + its own endpoint host in
   **784ms**; operations settled at **2.5s**; first successful query over the inherited
   role (same user/password/db, only the host swapped into `DATABASE_URL`) at **4.8s**
   after the create call. Host-swap URL construction works exactly as designed above.
2. **Inheritance + isolation.** The fork saw the parent's rows at fork time
   (`content_index` 3/3, `data_records` 10/10). Post-fork writes were invisible across the
   fork in **both** directions (branch→parent and parent→branch). `gen_random_uuid`
   defaults work on the fork — no Spike B sequence gotcha (uuid keys sidestep it anyway).
3. **Drop is clean.** `DELETE` (branch + endpoint) completed in **3.4s**; branch gone from
   the list; parent data byte-identical afterwards.

Operational findings for the `neon` backend (P4.3):

- **API keys can be project-scoped** (ours is): `GET /projects` 404s with
  `not allowed … subject_project_id:"…"`. The backend must take the **project id from
  config**, not discover it by listing.
- Branch endpoint hosts live on a different cell domain than the parent
  (`ep-….c-4.eu-central-1.aws.neon.tech`) — derive branch URLs by swapping the **whole
  host** from the API response, never by string-editing the parent's host.
- Create→usable is seconds, not ms: `resolve()` for a _fresh_ neon branch should poll until
  the first query succeeds (~5s worst case observed) or create should block until ready.

## First implementation unit (after this decision)

`branches` table + migration `0006`; `BranchBackend`/`BranchHandle` types + the `overlay`
backend (fully testable on local PG18 today — **no Neon needed**); migrate the current
`eq(branch_id, …)` read paths onto the resolved scope. `graft branch`/`merge` and the `neon`
backend follow — cloud CoW is now validated (see above), so nothing blocks either.

---

# Data semantics — DECIDED (2026-07-07, with the `neon` backend)

Two questions were open since P4.1; both are now locked:

## Previews inherit content, never operational data

A preview branch exists to preview a **code/content/schema** change, not to duplicate the
environment. So:

- **Content (`content_index`) is inherited** — overlay via the ancestor chain, neon via the
  storage fork. It is derived from git anyway; a recompile regenerates it.
- **Operational data (`data_records`) starts EMPTY on a branch.** It belongs to the
  environment (form submissions, orders — often PII), not the code version. Overlay already
  behaves this way (data reads are exact-branch, no chain); the `neon` backend **enforces**
  it by clearing `data_records` on the fork right after create. Both backends therefore mean
  the same thing, and `graft merge`'s data step stays **additive**: everything a branch
  holds is branch-created, so merge = move (overlay, same DB) or copy (neon, cross-DB) — no
  row-level conflict resolution exists to need.
- **`approvals` is also cleared on a neon fork:** approvals are one-shot by conditional
  UPDATE, which only works inside one database — a pending/approved row copied into a fork
  could be consumed there _and_ on the parent (one human decision, two executions).
- **`audit_log` stays on the fork:** append-only history; harmless and useful.

Consequences: no `deleted` tombstone column on `data_records` (nothing to tombstone — a
branch never sees parent rows), and `deleteRecord` stays a hard delete behind its human
gate. If branch-side _editing_ of inherited operational data is ever needed, that reopens
this decision (tombstones + real merge folding); until a vertical demands it, the simple
model wins.

## Physical scope semantics: the fork IS the branch

Inside a neon fork there is no `branch_id` scoping — rows keep the **default `main` id**
(they were physically copied from the parent). So `BranchScope { kind: "physical" }` reads
and writes `main` against the branch's own connection; `scopeChain` → `["main"]`,
`scopeWriteBranch` → `"main"`. The registry name is a label for routing, never a row value.
Corollary: a neon branch can only fork **main or another neon branch** — an overlay branch
has no physical form of its own (its rows live under a non-`main` id the physical scope
never reads), and `createNeonBranch` rejects it.

## Shipped shape (P4.3)

`@graft/db`: `neon.ts` (`createNeonBranch` / `dropNeonBranch` / `neonConfigFromEnv` —
`NEON_API_KEY` + `GRAFT_NEON_PROJECT_ID`, project id always from config) and
`resolveBranchHandle` — the `resolve()` seam from the abstraction above: name → connection
(shared for overlay, endpoint-host-swapped `createDb` for neon) + scope. The CLI routes
`compile` / `dev` / `migrate` / `merge` through it, so `--branch <neon-branch>` transparently
targets the fork. Failure convergence: a partway-failed create deletes the Neon branch
best-effort; a drop that finds the Neon branch already gone (404) still removes the registry
row. Errors are `BRANCH_BACKEND_FAILED` with the env/console fix.
