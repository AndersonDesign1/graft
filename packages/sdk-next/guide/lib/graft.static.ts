import { openStaticIndex } from "@usegraft/db";
import { createGraft } from "@usegraft/sdk-next";
import { collections } from "@/graft.config";

export const graft = createGraft({
  index: await openStaticIndex(".graft/index.db"),
  collections,
});
