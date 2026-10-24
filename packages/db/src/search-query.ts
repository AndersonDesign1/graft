/**
 * The search-query check, kept free of drizzle so the static index can use it
 * without loading the Postgres code.
 */
import { GraftError } from "@usegraft/contracts";

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
