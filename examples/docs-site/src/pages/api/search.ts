/**
 * Docs search = the product's search: Postgres FTS over content_index
 * (weighted tsvectors, GIN, websearch syntax) through the typed SDK surface.
 * Shaping the hits into fumadocs' SortedResult[] lives in lib/search-results,
 * where it can be tested without a database.
 */
import type { APIRoute } from "astro";
import { getGraft } from "../../lib/graft";
import { toSearchResults, type SortedResult } from "../../lib/search-results";

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    return Response.json([] satisfies SortedResult[]);
  }

  const hits = await getGraft().searchContent("docs", query, { limit: 8 });
  return Response.json(
    toSearchResults(
      hits.map((hit) => ({
        slug: hit.slug,
        title: hit.data.title,
        body: hit.body,
        snippet: hit.snippet,
      })),
      query,
    ),
  );
};
