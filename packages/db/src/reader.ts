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
import type {
  ContentIndexReader,
  ReaderReadOptions,
  ReaderSearchOptions,
} from "@usegraft/contracts";
import { readContent, resolveBranchScope, scopeChain, type BranchScope } from "./branch";
import type { Database } from "./client";
import { searchContent, type ContentSearchHit } from "./search";
import type { ContentRow } from "./schema";

// The seam itself is published from @usegraft/contracts, so a consumer can
// implement or describe it without a database driver. Re-exported here because
// this is where callers already import it from.
export type {
  ContentIndexReader,
  ReaderReadOptions,
  ReaderSearchOptions,
} from "@usegraft/contracts";

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
