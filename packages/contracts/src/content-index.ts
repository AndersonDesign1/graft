/**
 * The content-index read contract.
 *
 * These types used to live in `@usegraft/db`, which made them unreachable
 * without depending on the Postgres package — and `ContentRow` in particular
 * was `typeof contentIndex.$inferSelect`, derived from a Drizzle table. So the
 * shape every reader returns was defined by one implementation's storage
 * schema, and any consumer that merely wanted to *describe* a row (the HTTP
 * transport, the browser client) had to install a database driver to say so.
 *
 * They live here because this is the layer every package already shares.
 * `@usegraft/db` now proves its table still matches this contract rather than
 * defining it, which is the direction the dependency should have run in from
 * the start: the seam owns the shape, the implementation conforms to it.
 */

/** One row of the authored-content index. */
export interface ContentRow {
  branchId: string;
  collection: string;
  slug: string;
  /** Validated frontmatter. */
  data: Record<string, unknown>;
  /** Authored MDX source, byte-for-byte as written. */
  body: string;
  contentHash: string;
  sourcePath: string;
  /** Soft-delete marker. Readers exclude these. */
  deleted: boolean;
  updatedAt: Date;
  /** The FTS vector, when the implementation has one. */
  search: string | null;
}

export interface ReaderReadOptions {
  collection: string;
  /** When set, read a single document; otherwise the whole collection. */
  slug?: string;
  limit?: number;
  offset?: number;
  /** Branch to read; defaults to "main". Static readers serve their compiled branch regardless. */
  branch?: string;
}

export interface ReaderSearchOptions {
  /** Websearch-syntax query: words, "quoted phrases", `or`, -exclusions. */
  query: string;
  /** Restrict to these collections; defaults to all. */
  collections?: string[];
  /** Max hits, best-ranked first. Defaults to 20. */
  limit?: number;
  branch?: string;
}

export interface ContentSearchHit {
  row: ContentRow;
  /** Relevance rank: slug beats frontmatter beats body prose. */
  rank: number;
  /** Body fragment(s) with matches wrapped in `<b>…</b>`. */
  snippet: string;
}

/**
 * The seam between "who serves content reads" and "where the index lives".
 * Implemented by the Postgres reader, the compiled SQLite artifact, and the
 * HTTP reader in `@usegraft/content-api`.
 */
export interface ContentIndexReader {
  readContent(options: ReaderReadOptions): Promise<ContentRow[]>;
  searchContent(options: ReaderSearchOptions): Promise<ContentSearchHit[]>;
  close(): Promise<void>;
}

/** What one compile changed, by slug. */
export interface ChangeSet {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
}
