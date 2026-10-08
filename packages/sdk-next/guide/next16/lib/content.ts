import { cacheTag } from "next/cache";
import { tagsFor } from "@usegraft/sdk-next";
import { graft } from "@/lib/graft";

export async function getPage(slug: string) {
  "use cache";
  cacheTag(...tagsFor("main", "pages", slug));
  return graft.getContent("pages", slug);
}

export async function listPages() {
  "use cache";
  cacheTag(...tagsFor("main", "pages"));
  return graft.listContent("pages");
}
