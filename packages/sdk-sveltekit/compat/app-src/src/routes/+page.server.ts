import { graft } from "#lib/server/graft.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const [pages, hits] = await Promise.all([
    graft.listContent("pages"),
    graft.searchContent("pages", "navigation"),
  ]);
  return { pages, hits: hits.map((hit) => hit.slug) };
};
