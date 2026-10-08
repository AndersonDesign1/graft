/**
 * Docs search = the product's search, served from the compiled static index:
 * SQLite FTS5 over the same artifact the pages render from, through the typed
 * SDK surface. Shaping the hits into fumadocs' SortedResult[] lives in
 * lib/search-results, where it can be tested without any index at all.
 */
import type { APIRoute } from "astro";
import { getGraft } from "../../lib/graft";
import { toSearchResults, type SortedResult } from "../../lib/search-results";

/** Takes a query string, so it answers per request rather than prerendering. */
export const prerender = false;

/**
 * The index only changes when the site is rebuilt, and Vercel clears its CDN
 * cache on every deploy, so a result can be cached at the edge for as long as
 * the deployment lives. Measured before this: every query was a function call,
 * about 450ms warm and 1.3s cold.
 */
const CACHED = {
  "cache-control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
};

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    return Response.json([] satisfies SortedResult[], { headers: CACHED });
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
    { headers: CACHED },
  );
};
