/**
 * `@usegraft/db/static`: what the static engine needs, with no drizzle and no
 * Postgres driver behind it. The static index, the content diff, the search
 * query check and branch scopes. Loading the root entry costs a few hundred
 * milliseconds of Postgres code that a static project never runs, so the
 * compiler, the MCP server and the CLI import these from here.
 *
 * Everything here is also exported from the root entry.
 */
export * from "./static";
export * from "./diff";
export * from "./search-query";
export * from "./scope";
export type {
  ContentIndexReader,
  ContentSearchHit,
  ReaderReadOptions,
  ReaderSearchOptions,
} from "@usegraft/contracts";
