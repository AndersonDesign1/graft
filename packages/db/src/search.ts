/**
 * Postgres full-text search over the two indexes Graft owns: content_index
 * (authored content, derived from git) and data_records (operational data).
 *
 * Queries go through `websearch_to_tsquery` — plain words, quoted phrases,
 * `or`, and `-exclusions`, and it never throws on malformed input — so agents
 * can pass user-shaped strings straight through. The tsquery config must match
 * the 'english' config baked into the generated `search` columns (schema.ts);
 * change one and you must change both (and regenerate the columns).
 *
 * A query that reduces to nothing (only stopwords, e.g. "the") matches no rows
 * and returns [] — that is Postgres semantics, not an error.
 */
import { GraftError } from "@graft/contracts";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { overlaySubquery } from "./branch";
import type { Database } from "./client";
import { contentIndex, dataRecords, type ContentRow, type DataRecordRow } from "./schema";

/** Text-search config; must equal the config in schema.ts's generated columns. */
const SEARCH_CONFIG = "english";

/** ts_headline options: short fragments with <b>…</b> around the matched terms. */
const HEADLINE_OPTIONS = "MaxWords=20, MinWords=8, ShortWord=3, MaxFragments=2";

const DEFAULT_LIMIT = 20;

/**
 * Reject an empty query with the agent-actionable fix. Exported so search
 * surfaces (MCP `search_content`) can gate cheap input errors before paying
 * for branch-scope resolution or a database round-trip.
 */
export function assertSearchQuery(query: string): void {
  if (query.trim() === "") {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "Search query is empty.",
      fix: "Pass one or more words to search for. Quoted phrases, `or`, and -exclusions are supported (websearch syntax).",
      details: { query },
    });
  }
}

function toTsQuery(query: string): SQL {
  assertSearchQuery(query);
  return sql`websearch_to_tsquery(${SEARCH_CONFIG}, ${query})`;
}

export interface SearchContentOptions {
  /** Websearch-syntax query: words, "quoted phrases", `or`, -exclusions. */
  query: string;
  /** Branch chain to search across, leaf-first (from resolveBranchScope). Defaults to ["main"]. */
  chain?: string[];
  /** Restrict to these collections; defaults to all collections in the index. */
  collections?: string[];
  /** Max hits, best-ranked first. Defaults to 20. */
  limit?: number;
}

export interface ContentSearchHit {
  row: ContentRow;
  /** ts_rank over the weighted vector: slug (A) > frontmatter (B) > body (C). */
  rank: number;
  /** ts_headline fragment(s) of the body with matches wrapped in <b>…</b>. */
  snippet: string;
}

export async function searchContent(
  db: Database,
  options: SearchContentOptions,
): Promise<ContentSearchHit[]> {
  const tsQuery = toTsQuery(options.query);
  const chain = options.chain ?? ["main"];

  // Fast path: single-branch search hits the GIN index directly (WHERE search @@ q).
  if (chain.length === 1) {
    const filters = [
      eq(contentIndex.branchId, chain[0]),
      eq(contentIndex.deleted, false),
      sql`${contentIndex.search} @@ ${tsQuery}`,
    ];
    if (options.collections !== undefined) {
      filters.push(inArray(contentIndex.collection, options.collections));
    }
    return db
      .select({
        row: contentIndex,
        rank: sql<number>`ts_rank(${contentIndex.search}, ${tsQuery})`,
        snippet: sql<string>`ts_headline(${SEARCH_CONFIG}, ${contentIndex.body}, ${tsQuery}, ${HEADLINE_OPTIONS})`,
      })
      .from(contentIndex)
      .where(and(...filters))
      .orderBy(desc(sql`ts_rank(${contentIndex.search}, ${tsQuery})`), asc(contentIndex.slug))
      .limit(options.limit ?? DEFAULT_LIMIT);
  }

  // Overlay path: search the branch-winning row per (collection, slug) — the same
  // rows `readContent` would return — so a preview searches its effective content,
  // not stale ancestor copies of docs it has overridden or tombstoned.
  const overlay = overlaySubquery(db, chain, { collections: options.collections });
  const rows = await db
    .select({
      branchId: overlay.branchId,
      collection: overlay.collection,
      slug: overlay.slug,
      data: overlay.data,
      body: overlay.body,
      contentHash: overlay.contentHash,
      sourcePath: overlay.sourcePath,
      deleted: overlay.deleted,
      updatedAt: overlay.updatedAt,
      search: overlay.search,
      rank: sql<number>`ts_rank(${overlay.search}, ${tsQuery})`,
      snippet: sql<string>`ts_headline(${SEARCH_CONFIG}, ${overlay.body}, ${tsQuery}, ${HEADLINE_OPTIONS})`,
    })
    .from(overlay)
    .where(and(eq(overlay.deleted, false), sql`${overlay.search} @@ ${tsQuery}`))
    .orderBy(desc(sql`ts_rank(${overlay.search}, ${tsQuery})`), asc(overlay.slug))
    .limit(options.limit ?? DEFAULT_LIMIT);

  return rows.map(({ rank, snippet, ...row }) => ({ row: row as ContentRow, rank, snippet }));
}

export interface SearchDataOptions {
  /** Websearch-syntax query: words, "quoted phrases", `or`, -exclusions. */
  query: string;
  /** Records are always searched per collection (mirrors listRecords). */
  collection: string;
  branchId?: string;
  /** Max hits, best-ranked first. Defaults to 20. */
  limit?: number;
}

export interface DataSearchHit {
  row: DataRecordRow;
  rank: number;
}

export async function searchData(
  db: Database,
  options: SearchDataOptions,
): Promise<DataSearchHit[]> {
  const tsQuery = toTsQuery(options.query);

  return db
    .select({
      row: dataRecords,
      rank: sql<number>`ts_rank(${dataRecords.search}, ${tsQuery})`,
    })
    .from(dataRecords)
    .where(
      and(
        eq(dataRecords.branchId, options.branchId ?? "main"),
        eq(dataRecords.collection, options.collection),
        sql`${dataRecords.search} @@ ${tsQuery}`,
      ),
    )
    .orderBy(desc(sql`ts_rank(${dataRecords.search}, ${tsQuery})`), desc(dataRecords.createdAt))
    .limit(options.limit ?? DEFAULT_LIMIT);
}
