/**
 * The static content index — Postgres' Job A as a single SQLite file.
 *
 * `projectStaticContent` is the write side: a full rebuild of the artifact
 * into a temp file + rename, diffed against the previous artifact with the
 * same pure `diffBranchContent` the Postgres projection uses, so the returned
 * ChangeSet (and preserved `updated_at` on unchanged rows — the cache
 * contract) mean exactly what they mean there. `openStaticIndex` is the read
 * side: a ContentIndexReader over the file, opened read-only so read-only
 * deployed filesystems (serverless) work.
 *
 * Engine: the `node:sqlite` built-in with FTS5 (Node ≥ 22.16) — zero npm dependencies,
 * FTS5 with porter stemming for search. The SQL is deliberately portable
 * SQLite so a remote backend (libsql/Turso/D1) later is an adapter, not a
 * port. Operational data (Job B: data_records, audit, approvals) is out of
 * scope by design — that is what NEEDS_DATABASE teaches.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { diffBranchContent, type ChangeSet, type ContentInput } from "./diff";
import type { ContentIndexReader } from "./reader";
import type { ContentRow } from "./schema";
import { assertSearchQuery, type ContentSearchHit } from "./search";

export const STATIC_INDEX_FORMAT_VERSION = 1;
/** Default artifact path, relative to the project root. */
export const STATIC_INDEX_DEFAULT_PATH = ".graft/index.db";
/** Compilation history carried across rebuilds (Studio parity, not an audit log). */
const COMPILATIONS_KEPT = 50;

/** bm25 column weights: slug > frontmatter strings > body (mirrors the Postgres A/B/C vector). */
const BM25_WEIGHTS = "10.0, 5.0, 1.0";
const SNIPPET = `snippet(content_fts, 2, '<b>', '</b>', '…', 20)`;

// ---------------------------------------------------------------------------
// node:sqlite loading — lazy, so merely importing @usegraft/db never requires
// Node 22.16 (FTS5 ships in the bundled SQLite from 22.16.0); only actually using static mode does.
// ---------------------------------------------------------------------------

// Minimal structural types for the slice of node:sqlite we use (its own types
// live in @types/node ≥ 22; structural keeps our published d.ts self-contained).
interface SqliteStatement {
  all(...params: Array<string | number | null>): Record<string, unknown>[];
  get(...params: Array<string | number | null>): Record<string, unknown> | undefined;
  run(...params: Array<string | number | null>): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
type SqliteCtor = new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;

async function loadSqlite(): Promise<SqliteCtor> {
  // process.getBuiltinModule (Node 22.3+) instead of import(): bundlers (vite,
  // Next/Turbopack) rewrite dynamic imports and predate node:sqlite in their
  // builtin lists; this call is opaque to them and returns undefined when absent.
  const mod = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync: SqliteCtor } | undefined;
  if (mod?.DatabaseSync) return mod.DatabaseSync;
  {
    throw new GraftError({
      code: "STATIC_INDEX_UNSUPPORTED",
      message: `Static index mode needs the node:sqlite built-in, which this Node (${process.version}) does not provide.`,
      fix: `Upgrade Node to 22.16+ (24 LTS recommended), or switch the project to the Postgres index (set DATABASE_URL and \`export const index = "postgres"\` in graft.config).`,
      details: { node: process.version },
    });
  }
}

// ---------------------------------------------------------------------------
// websearch → FTS5 MATCH translation
// ---------------------------------------------------------------------------

/**
 * Translate the websearch surface (words, "quoted phrases", `or`,
 * -exclusions) into an FTS5 MATCH expression. Every term is double-quoted, so
 * arbitrary user/agent input can never produce an FTS5 syntax error. Returns
 * null when nothing searchable remains (only exclusions / only quotes) — the
 * caller returns [] for that, matching Postgres' stopword semantics.
 */
export function toFtsMatch(query: string): string | null {
  const tokens = query.match(/"[^"]*"|\S+/g) ?? [];

  // Split into OR groups the way websearch_to_tsquery treats a bare `or`.
  const groups: Array<{ include: string[]; exclude: string[] }> = [];
  let current = { include: [] as string[], exclude: [] as string[] };
  let sawToken = false;
  const flush = (): void => {
    if (current.include.length > 0 || current.exclude.length > 0) groups.push(current);
    current = { include: [], exclude: [] };
  };

  for (const raw of tokens) {
    if (/^or$/i.test(raw) && sawToken) {
      flush();
      continue;
    }
    sawToken = true;
    let term = raw;
    let negated = false;
    if (term.startsWith("-")) {
      negated = true;
      term = term.slice(1);
    }
    // Strip the user's quotes; re-quote below (phrases keep internal spaces).
    term = term.replace(/^"|"$/g, "").replace(/"/g, " ").trim();
    if (term === "") continue;
    const quoted = `"${term}"`;
    if (negated) current.exclude.push(quoted);
    else current.include.push(quoted);
  }
  flush();

  const parts = groups
    // A group with no positive terms cannot match anything to subtract from.
    .filter((g) => g.include.length > 0)
    .map((g) => {
      // Space = AND in FTS5; NOT is left-associative set difference.
      let expr = g.include.join(" ");
      for (const ex of g.exclude) expr += ` NOT ${ex}`;
      return groups.length > 1 ? `(${expr})` : expr;
    });

  return parts.length > 0 ? parts.join(" OR ") : null;
}

/** Frontmatter string values, recursively — the FTS "front" column (weight B). */
export function frontText(data: unknown): string {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) {
      for (const v of Object.values(value)) walk(v);
    }
  };
  walk(data);
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Write side
// ---------------------------------------------------------------------------

export interface ProjectStaticOptions {
  /** Artifact path (absolute or cwd-relative), e.g. <project>/.graft/index.db. */
  path: string;
  /** Git commit the content tree was compiled from; recorded in meta + compilations. */
  gitSha?: string | null;
  /** Recorded in meta; reads report it as the row's branchId. Defaults to "main". */
  branch?: string;
}

interface PreviousArtifact {
  rows: Array<{
    collection: string;
    slug: string;
    contentHash: string;
    sourcePath: string;
    updatedAt: number;
  }>;
  compilations: Record<string, unknown>[];
}

function readPrevious(Database: SqliteCtor, path: string): PreviousArtifact {
  if (!existsSync(path)) return { rows: [], compilations: [] };
  let db: SqliteDatabase | undefined;
  try {
    db = new Database(path, { readOnly: true });
    const rows = db
      .prepare("SELECT collection, slug, content_hash, source_path, updated_at FROM content_index")
      .all()
      .map((r) => ({
        collection: r.collection as string,
        slug: r.slug as string,
        contentHash: r.content_hash as string,
        sourcePath: r.source_path as string,
        updatedAt: r.updated_at as number,
      }));
    const compilations = db
      .prepare(
        `SELECT branch, git_sha, doc_count, added, changed, removed, created_at FROM compilations ORDER BY created_at DESC LIMIT ${COMPILATIONS_KEPT - 1}`,
      )
      .all();
    return { rows, compilations };
  } catch {
    // A corrupt or foreign file is not fatal to a full rebuild: treat as first
    // compile (everything reports "added" — honest, since nothing diffable existed).
    return { rows: [], compilations: [] };
  } finally {
    db?.close();
  }
}

/**
 * Project compiled content into the static artifact. Full rebuild, atomic-ish
 * (temp file + rename), ChangeSet diffed against the previous artifact.
 */
export async function projectStaticContent(
  rows: ContentInput[],
  options: ProjectStaticOptions,
): Promise<ChangeSet> {
  const Database = await loadSqlite();
  const branch = options.branch ?? "main";
  const previous = readPrevious(Database, options.path);

  const { changes } = diffBranchContent(
    previous.rows.map((r) => ({ ...r, deleted: false })),
    rows,
  );
  const previousUpdatedAt = new Map(
    previous.rows.map((r) => [`${r.collection}/${r.slug}`, r.updatedAt]),
  );

  mkdirSync(dirname(options.path), { recursive: true });
  const tmpPath = `${options.path}.tmp-${process.pid}`;
  const now = Date.now();
  const db = new Database(tmpPath);
  try {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE content_index (
        collection TEXT NOT NULL,
        slug TEXT NOT NULL,
        data TEXT NOT NULL,
        body TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_path TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, slug)
      );
      CREATE VIRTUAL TABLE content_fts USING fts5(slug, front, body, tokenize='porter unicode61');
      CREATE TABLE compilations (
        branch TEXT NOT NULL,
        git_sha TEXT,
        doc_count INTEGER NOT NULL,
        added INTEGER NOT NULL,
        changed INTEGER NOT NULL,
        removed INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    const insertRow = db.prepare(
      "INSERT INTO content_index (collection, slug, data, body, content_hash, source_path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertFts = db.prepare(
      "INSERT INTO content_fts (rowid, slug, front, body) VALUES (?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    let rowid = 0;
    for (const row of rows) {
      rowid += 1;
      const key = `${row.collection}/${row.slug}`;
      // Unchanged rows keep their timestamp — "what changed" stays meaningful
      // to caches even though the file is rebuilt from scratch.
      const keptAt =
        changes.added.includes(key) || changes.changed.includes(key)
          ? now
          : (previousUpdatedAt.get(key) ?? now);
      insertRow.run(
        row.collection,
        row.slug,
        JSON.stringify(row.data),
        row.body,
        row.contentHash,
        row.sourcePath,
        keptAt,
      );
      // FTS slug column gets the kebab words, not the raw slug, so
      // "getting-started" matches a search for "started".
      insertFts.run(rowid, row.slug.replace(/-/g, " "), frontText(row.data), row.body);
    }

    const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    insertMeta.run("formatVersion", String(STATIC_INDEX_FORMAT_VERSION));
    insertMeta.run("branch", branch);
    insertMeta.run("compiledAt", String(now));
    if (options.gitSha) insertMeta.run("gitSha", options.gitSha);

    const insertCompilation = db.prepare(
      "INSERT INTO compilations (branch, git_sha, doc_count, added, changed, removed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const prev of previous.compilations.reverse()) {
      insertCompilation.run(
        (prev.branch as string) ?? branch,
        (prev.git_sha as string | null) ?? null,
        (prev.doc_count as number) ?? 0,
        (prev.added as number) ?? 0,
        (prev.changed as number) ?? 0,
        (prev.removed as number) ?? 0,
        (prev.created_at as number) ?? now,
      );
    }
    insertCompilation.run(
      branch,
      options.gitSha ?? null,
      rows.length,
      changes.added.length,
      changes.changed.length,
      changes.removed.length,
      now,
    );
    db.exec("COMMIT");
  } finally {
    db.close();
  }

  // Replace the previous artifact atomically where the platform allows it.
  //
  // This used to rmSync first and then rename, which left a window where the
  // artifact did not exist at all — a concurrent reader got
  // STATIC_INDEX_NOT_FOUND rather than "stale or new", and a crash between the
  // two destroyed the index until the next successful compile. The comment
  // claiming readers "open a fully-written file or the old one" described the
  // intent, not the code.
  //
  // rename(2) replaces the destination atomically on POSIX. Windows rejects
  // rename-over-existing, so fall back there — and only there.
  try {
    renameSync(tmpPath, options.path);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" &&
      (error as NodeJS.ErrnoException).code !== "EPERM" &&
      (error as NodeJS.ErrnoException).code !== "EACCES"
    ) {
      throw error;
    }
    rmSync(options.path, { force: true });
    renameSync(tmpPath, options.path);
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export interface StaticIndexInfo {
  formatVersion: number;
  branch: string;
  gitSha: string | null;
  compiledAt: Date;
}

export interface StaticIndexReader extends ContentIndexReader {
  readonly info: StaticIndexInfo;
}

/** Open the compiled artifact read-only as a ContentIndexReader. */
export async function openStaticIndex(path: string): Promise<StaticIndexReader> {
  const Database = await loadSqlite();
  if (!existsSync(path)) {
    throw new GraftError({
      code: "STATIC_INDEX_NOT_FOUND",
      message: `Static index not found at ${path}.`,
      fix: `Run \`graft compile\` to build it (and make sure the deploy's build step runs it before the app builds, so the artifact ships with the app).`,
      details: { path },
    });
  }
  const db = new Database(path, { readOnly: true });

  const metaRows = db.prepare("SELECT key, value FROM meta").all();
  const meta = new Map(metaRows.map((r) => [r.key as string, r.value as string]));
  const info: StaticIndexInfo = {
    formatVersion: Number(meta.get("formatVersion") ?? 0),
    branch: meta.get("branch") ?? "main",
    gitSha: meta.get("gitSha") ?? null,
    compiledAt: new Date(Number(meta.get("compiledAt") ?? 0)),
  };

  const toContentRow = (r: Record<string, unknown>): ContentRow => ({
    branchId: info.branch,
    collection: r.collection as string,
    slug: r.slug as string,
    data: JSON.parse(r.data as string) as Record<string, unknown>,
    body: r.body as string,
    contentHash: r.content_hash as string,
    sourcePath: r.source_path as string,
    deleted: false,
    updatedAt: new Date(r.updated_at as number),
    // No tsvector in the static index — FTS5 owns search here.
    search: null,
  });

  return {
    info,

    // `branch` is deliberately ignored: the artifact IS the branch (each git
    // checkout compiles its own file — the P4.3 physical-scope idea as a file).
    async readContent(options) {
      const filters = ["collection = ?"];
      const params: Array<string | number> = [options.collection];
      if (options.slug !== undefined) {
        filters.push("slug = ?");
        params.push(options.slug);
      }
      let sql = `SELECT * FROM content_index WHERE ${filters.join(" AND ")} ORDER BY slug ASC`;
      if (options.limit !== undefined) {
        sql += " LIMIT ?";
        params.push(options.limit);
      } else if (options.offset !== undefined) {
        sql += " LIMIT -1";
      }
      if (options.offset !== undefined) {
        sql += " OFFSET ?";
        params.push(options.offset);
      }
      return db
        .prepare(sql)
        .all(...params)
        .map(toContentRow);
    },

    async searchContent(options): Promise<ContentSearchHit[]> {
      assertSearchQuery(options.query);
      const match = toFtsMatch(options.query);
      if (match === null) return [];

      const filters = ["content_fts MATCH ?"];
      const params: Array<string | number> = [match];
      if (options.collections !== undefined) {
        if (options.collections.length === 0) return [];
        filters.push(`ci.collection IN (${options.collections.map(() => "?").join(", ")})`);
        params.push(...options.collections);
      }
      params.push(options.limit ?? 20);
      const rows = db
        .prepare(
          `SELECT ci.*,
                  -bm25(content_fts, ${BM25_WEIGHTS}) AS rank,
                  ${SNIPPET} AS snippet
           FROM content_fts
           JOIN content_index ci ON ci.rowid = content_fts.rowid
           WHERE ${filters.join(" AND ")}
           ORDER BY bm25(content_fts, ${BM25_WEIGHTS}) ASC, ci.slug ASC
           LIMIT ?`,
        )
        .all(...params);
      return rows.map((r) => ({
        row: toContentRow(r),
        rank: r.rank as number,
        snippet: r.snippet as string,
      }));
    },

    async close() {
      db.close();
    },
  };
}
