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
  (including sequences), no app-level overlay. **PENDING validation** — not testable
  without a Neon account; revisit when cloud creds are available.
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
