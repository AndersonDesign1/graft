/**
 * Docs search = the product's search: Postgres FTS over content_index
 * (weighted tsvectors, GIN, websearch syntax) through the typed SDK surface.
 * Returns the SortedResult[] shape fumadocs' fetch search client expects.
 */
import type { APIRoute } from "astro";
import { getGraft } from "../../lib/graft";

interface SortedResult {
  id: string;
  url: string;
  type: "page" | "heading" | "text";
  content: string;
}

const stripMarks = (s: string) => s.replace(/<\/?b>/g, "");

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    return Response.json([] satisfies SortedResult[]);
  }

  const hits = await getGraft().searchContent("docs", query, { limit: 8 });
  const results: SortedResult[] = hits.flatMap((hit) => [
    {
      id: hit.slug,
      url: `/docs/${hit.slug}`,
      type: "page" as const,
      content: hit.data.title,
    },
    {
      id: `${hit.slug}-snippet`,
      url: `/docs/${hit.slug}`,
      type: "text" as const,
      content: stripMarks(hit.snippet),
    },
  ]);

  return Response.json(results);
};
