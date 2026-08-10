# Static index mode — zero-service content projects (L1)

> Decided 2026-08-10. Pairs with the launch plan (phases.md). Status: shipping.

## Problem

Graft's minimum stack for a marketing site is Node + Postgres. The Netlify /
Vercel / Cloudflare crowd compares us to Contentlayer, Keystatic, and Astro
Content Collections — which need zero services. Our own invariant already says
the answer: **Postgres is a derived index for authored content.** For a
content-only project the database holds nothing git cannot rebuild. So it can
be a file.

## Decision

Split the two jobs Postgres does:

- **Job A — content index** (content_index, FTS, compilations): derived.
  Now replaceable by a **SQLite artifact** the compiler emits.
- **Job B — operational data** (data_records, audit_log, approvals, rate
  limits, DB branching): real state. **Stays Postgres.** Nothing moves.

A project declares its index driver in `graft.config.ts`:

```ts
export const index = "static"; // or { driver: "static", path: ".graft/index.db" }
// default: "postgres" (DATABASE_URL, unchanged)
```

`graft compile` in static mode writes `.graft/index.db` — one SQLite file,
committed or built in CI, deployed with the app. Reads embed it. No server,
no connection string, no env vars.

## Engine: `node:sqlite`, zero dependencies

Spike (2026-08-10, Node 24.18): the built-in `node:sqlite` DatabaseSync ships
FTS5 (porter stemmer verified) and JSON1. So the static driver adds **zero
npm dependencies** and no native build step — it works on Vercel, Netlify,
and any Node ≥ 22.12 serverless runtime. Readers open `{ readOnly: true }`,
so read-only deployed filesystems are fine (that is the whole point).

Rejected alternatives: better-sqlite3 (native build pain on serverless),
sql.js (WASM weight), PGlite (megabytes + single-connection), libsql (a
dependency we don't need yet — but the **SQL stays portable** so a
libsql/Turso/**D1** remote backend later is an adapter, not a port).

## The seam: `ContentIndexReader`

sdk-core touched exactly four db functions: `resolveBranchScope`,
`scopeChain`, `readContent`, `searchContent`. Those become one interface:

```ts
interface ContentIndexReader {
  readContent(q: { collection; slug?; limit?; offset?; branch? }): Promise<ContentRow[]>;
  searchContent(q: { query; collections?; limit?; branch? }): Promise<ContentSearchHit[]>;
  close(): Promise<void>;
}
```

- `createDbIndexReader(db)` — the Postgres adapter; owns the per-branch scope
  memo that used to live in sdk-core. Behaviour byte-identical.
- `openStaticIndex(path)` — the SQLite adapter. `branch` is accepted and
  ignored: **the artifact IS the branch** (each git checkout compiles its
  own file — the physical-scope idea from P4.3, applied to a file).
- sdk-core `createClient({ db })` still works (wraps the db adapter);
  `createClient({ index })` is the new static path. Framework SDKs forward.

## Artifact format (formatVersion 1)

```
meta          key/value: formatVersion, branch, gitSha, compiledAt
content_index collection, slug, data (JSON text), body, content_hash,
              source_path, updated_at (ms) — PK (collection, slug)
content_fts   fts5(slug, front, body, tokenize='porter unicode61'),
              rowid shared with content_index; front = the frontmatter's
              string values, mirroring the Postgres weighted vector
compilations  last 50 runs carried forward (git SHA + counts) — Studio parity
```

Search ranking: `-bm25(content_fts, 10, 5, 1)` → slug > frontmatter > body,
higher-is-better like `ts_rank`. Snippets via fts5 `snippet()` with `<b>` marks.
Query translation `toFtsMatch` covers the same websearch surface (words,
"quoted phrases", `or`, -exclusions), quotes every term so malformed input
can never throw, and returns null (→ `[]`) when nothing searchable remains.
Empty queries still fail `INPUT_VALIDATION_FAILED` via the shared
`assertSearchQuery` — invalid input never touches the index.

Writes are a **full rebuild into a temp file + rename** — atomic enough for a
build artifact, and the shared-DATABASE_URL footgun (INDEX_OWNERSHIP) cannot
exist: the artifact lives in the project. The ChangeSet is still real:
projection diffs against the previous artifact via the same pure
`diffBranchContent`, and unchanged rows keep their `updated_at` (the cache
contract survives).

## Self-teaching boundaries (new codes)

- `NEEDS_DATABASE` — a Postgres-tier feature (db-authoritative collections,
  functions, DB branching via `--branch`) used in static mode. The fix
  teaches the upgrade: set DATABASE_URL + `index = "postgres"`.
- `STATIC_INDEX_NOT_FOUND` — reads before the first compile. Fix: `graft compile`.
- `STATIC_INDEX_UNSUPPORTED` — Node < 22.12 (no `node:sqlite`). Fix: upgrade Node.

## The agent surface is not a Postgres-tier feature

Graft's thesis is that an agent is the primary operator, so `graft mcp` serves
a static project too: `db` on `createGraftMcp` is optional, and
`staticIndexPath` selects the artifact. Authoring is identical — files are the
truth, `write_content` validates and recompiles — and `search_content` reads
the artifact. The static artifact is opened **per operation and closed**, which
keeps the server as stateless as the Postgres path (no handle to leak, no
lifetime question for the HTTP handler).

Postgres-tier tools stay registered rather than disappearing, and answer
`NEEDS_DATABASE` naming what they needed and how to upgrade — an absent tool
teaches nothing. Two calls deserve their reasons recorded:

- **`delete_content` refuses.** Its one-shot, input-bound human approval lives
  in Postgres. Serving it without that would silently downgrade a gated
  destructive op to an ungated one. The fix points at the honest static answer:
  delete the file and recompile — git is authoritative, so the file _is_ the
  document and git history is the undo.
- **`list_compilations` refuses** even though the artifact carries recent runs:
  the Postgres trail is the full history, and returning a truncated one under
  the same name would be a quieter lie than a clear error. Exposing it as its
  own artifact-scoped surface is open.

## Boundary enforcement

A static project that declares typed functions or db-authoritative collections
cannot work, so `loadConfig` refuses it with `NEEDS_DATABASE` — at load, not at
the point it eventually breaks. The message names the offending collections and
functions; the fix gives the order: set DATABASE_URL, switch `index`, run
`graft db migrate`, then `graft compile`.

## `graft db migrate`

The Postgres tier must be installable from npm alone. The generated SQL ships
inside `@usegraft/db` (`files: ["dist", "drizzle"]`), and `runMigrations`
resolves it path-form (the P6.3 `registryRoot()` lesson) so a consumer needs no
drizzle-kit and no checked-out migrations. **It applies by default** — a
deliberate divergence from `graft migrate` / `graft merge`, whose `--apply`
consent exists because they transform authored bytes and rows. This is
generated, additive, idempotent DDL and the prerequisite for anything working;
`--dry-run` lists what is pending. The container entrypoint has always run it
unattended for the same reason.

## Out of scope (this unit)

- `graft serve` over a static index: serve exists to run typed functions and
  the HTTP MCP endpoint, and functions are Postgres-tier by construction.
  Static projects deploy as built sites, not as a Graft server.
- Studio over a static index — Studio work is the next milestone (L2); its
  read path already merges disk with the index, so this is a driver swap there.
- Remote SQLite backends (Turso/D1) — same dialect by construction, later.
