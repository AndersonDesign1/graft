import { unstable_cache } from "next/cache";
import { tagsFor } from "@usegraft/sdk-next";
import { graft } from "./graft";

// A tagged read with a fresh stamp each time it actually runs. The stamp
// changes only when the cache entry was refreshed, which is what the smoke
// test watches for.
export const getHomeStamp = unstable_cache(
  async () => {
    const page = await graft.getContent("pages", "home");
    return { title: page?.data.title ?? null, stamp: crypto.randomUUID() };
  },
  ["graft-compat-home-stamp"],
  { tags: tagsFor("main", "pages", "home") },
);
