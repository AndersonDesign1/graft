import { graft } from "#lib/server/graft.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const [pages, hits] = await Promise.all([
    graft.listContent("pages"),
    graft.searchContent("pages", "navigation"),
  ]);
  // Only what the page shows: a load's return value is sent to the browser.
  return {
    pages: pages.map((page) => ({ slug: page.slug, title: page.data.title })),
    hits: hits.map((hit) => hit.slug),
  };
};
