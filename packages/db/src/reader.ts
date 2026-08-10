/**
 * ContentIndexReader — the seam between "who serves content reads" and
 * "where the index lives". sdk-core (and everything above it) consumes this
 * interface only; the two implementations are:
 *
 * - `createDbIndexReader` (here): the Postgres index, overlay-branch aware.
 *   Owns the per-branch scope memo that used to live in sdk-core — one
 *   topology lookup per branch per reader, shared across concurrent reads.
 * - `openStaticIndex` (static.ts): the compiled SQLite artifact — no server,
 *   no env; the artifact IS the branch.
 */
import { readContent, resolveBranchScope, scopeChain, type BranchScope } from "./branch";
import type { Database } from "./client";
import { searchContent, type ContentSearchHit } from "./search";
import type { ContentRow } from "./schema";

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

export interface ContentIndexReader {
  readContent(options: ReaderReadOptions): Promise<ContentRow[]>;
  searchContent(options: ReaderSearchOptions): Promise<ContentSearchHit[]>;
  close(): Promise<void>;
}

/** The Postgres-backed reader over an existing Database handle (does not own/close it). */
export function createDbIndexReader(db: Database): ContentIndexReader {
  // One in-flight/settled scope resolution per branch, shared by concurrent
  // reads. A reader is typically request-scoped (sdk-next dedupes via
  // React.cache); a topology change is picked up by the next reader.
  const scopeCache = new Map<string, Promise<BranchScope>>();
  const scopeFor = (branch: string): Promise<BranchScope> => {
    let cached = scopeCache.get(branch);
    if (cached === undefined) {
      cached = resolveBranchScope(db, branch);
      scopeCache.set(branch, cached);
    }
    return cached;
  };

  return {
    async readContent(options) {
      const scope = await scopeFor(options.branch ?? "main");
      return readContent(db, scope, {
        collection: options.collection,
        slug: options.slug,
        limit: options.limit,
        offset: options.offset,
      });
    },
    async searchContent(options) {
      const scope = await scopeFor(options.branch ?? "main");
      return searchContent(db, {
        query: options.query,
        chain: scopeChain(scope),
        collections: options.collections,
        limit: options.limit,
      });
    },
    // The caller owns the Database (pool close is a lifecycle decision above us).
    async close() {},
  };
}
