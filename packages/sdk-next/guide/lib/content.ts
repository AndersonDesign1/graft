import { unstable_cache } from "next/cache";
import { tagsFor } from "@usegraft/sdk-next";
import { graft } from "@/lib/graft";

// unstable_cache stores results as JSON, so `updatedAt` comes back as a
// string. Turn it back into a Date, so every value matches its type.
function revive<T extends { updatedAt: Date }>(doc: T): T {
  return { ...doc, updatedAt: new Date(doc.updatedAt) };
}

export async function getPage(slug: string) {
  const page = await unstable_cache(
    () => graft.getContent("pages", slug),
    ["graft", "pages", slug],
    { tags: tagsFor("main", "pages", slug) },
  )();
  return page && revive(page);
}

const cachedPages = unstable_cache(() => graft.listContent("pages"), ["graft", "pages"], {
  tags: tagsFor("main", "pages"),
});

export async function listPages() {
  return (await cachedPages()).map(revive);
}
