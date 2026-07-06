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
import type { Database } from "./client";
import { contentIndex, dataRecords, type ContentRow, type DataRecordRow } from "./schema";

/** Text-search config; must equal the config in schema.ts's generated columns. */
const SEARCH_CONFIG = "english";

/** ts_headline options: short fragments with <b>…</b> around the matched terms. */
const HEADLINE_OPTIONS = "MaxWords=20, MinWords=8, ShortWord=3, MaxFragments=2";

const DEFAULT_LIMIT = 20;

function toTsQuery(query: string): SQL {
  if (query.trim() === "") {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "Search query is empty.",
      fix: "Pass one or more words to search for. Quoted phrases, `or`, and -exclusions are supported (websearch syntax).",
      details: { query },
    });
  }
  return sql`websearch_to_tsquery(${SEARCH_CONFIG}, ${query})`;
}

export interface SearchContentOptions {
  /** Websearch-syntax query: words, "quoted phrases", `or`, -exclusions. */
  query: string;
  branchId?: string;
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
  const filters = [
    eq(contentIndex.branchId, options.branchId ?? "main"),
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
