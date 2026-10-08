/**
 * Docs search = the product's search, served from the compiled static index:
 * SQLite FTS5 over the same artifact the pages render from, through the typed
 * SDK surface. Shaping the hits into fumadocs' SortedResult[] lives in
 * lib/search-results, where it can be tested without any index at all.
 */
import type { APIRoute } from "astro";
import { getGraft } from "../../lib/graft";
import { buildVocabulary, expandQuery, type Vocabulary } from "../../lib/search-expand";
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

/**
 * Every word in the docs, for completing the word being typed. Built once per
 * function instance from the same index the search reads, so a completion is
 * always a word some page contains.
 */
let vocabulary: Promise<Vocabulary> | null = null;
function docsVocabulary(): Promise<Vocabulary> {
  if (vocabulary) return vocabulary;
  const building = getGraft()
    .listContent("docs")
    .then((docs) => buildVocabulary(docs.flatMap((doc) => [doc.data.title, doc.body])))
    .catch((error: unknown) => {
      // Do not cache a failure: the next request tries again.
      vocabulary = null;
      throw error;
    });
  vocabulary = building;
  return building;
}

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    return Response.json([] satisfies SortedResult[], { headers: CACHED });
  }

  // Partial last word ("conf") widened to the words it could become, so
  // results show while the reader is still typing. See lib/search-expand.
  const expanded = expandQuery(query, await docsVocabulary());
  const hits = await getGraft().searchContent("docs", expanded, { limit: 8 });
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
