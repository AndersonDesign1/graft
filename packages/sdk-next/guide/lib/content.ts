import { unstable_cache } from "next/cache";
import { tagsFor } from "@usegraft/sdk-next";
import { graft } from "@/lib/graft";

export function getPage(slug: string) {
  return unstable_cache(() => graft.getContent("pages", slug), ["graft", "pages", slug], {
    tags: tagsFor("main", "pages", slug),
  })();
}

export const listPages = unstable_cache(() => graft.listContent("pages"), ["graft", "pages"], {
  tags: tagsFor("main", "pages"),
});
