# Content projection (Spike A findings)

Hand-off from the Phase 1 spike to the real `@graft/compiler` + `@graft/db` work.

## Question

Can authored content files be projected into a Postgres index **atomically** and
**deterministically** (so the index is a pure function of the files, and a failed
projection never leaves partial state)?

## What was tested

`spikes/spike-a.mjs` (throwaway): walked `*.mdx` fixtures, parsed frontmatter with
`gray-matter`, and full-rebuilt a `content_index` table inside a single transaction.
Ran the projection twice and hashed the ordered result; then forced a failure mid-transaction.

## Result — ✅ GO

- **Deterministic:** two runs produced byte-identical snapshot hashes
  (`a5502ca4…` == `a5502ca4…`).
- **Atomic:** a thrown error mid-projection rolled back; the prior snapshot was preserved.

## Decisions for the real implementation

1. **Git is the source of truth; Postgres `content_index` is a derived projection.**
   If they ever disagree, the compiler rebuilds the index from files (core invariant).
2. **Projection runs in a transaction** (`sql.begin`) — atomic by construction.
3. **Store structured frontmatter as `jsonb`.** Postgres canonicalizes `jsonb` key
   order, which removes a whole class of nondeterminism for free.
4. **Per-document `content_hash`** (sha256 of raw bytes) — drives change detection and
   the future cache-invalidation contract (`sdk-core.subscribe`).
5. **Stable ordering** (`ORDER BY collection, slug`) for any snapshot/diff/compare.
6. **Deterministic serialization** for hashing (recursively sorted keys) — don't rely on
   `JSON.stringify` insertion order.

## Deferred (not needed to de-risk, but for the real build)

- **Incremental projection:** Spike A did a full rebuild. The real compiler should diff
  by `content_hash` and upsert only changed docs (full rebuild stays as the
  reconciliation fallback that guarantees determinism).
- Reference + slug validation (`validateReferences`, `validateSlugs`) → agent-actionable errors.
- Silence Postgres notices in the client (`postgres(url, { onnotice: () => {} })`).

## Throwaway artifacts

`spikes/` is git-ignored. Re-run with `node spikes/spike-a.mjs` (needs the compose DB up).
