import { createGraftMcpHandler } from "@usegraft/mcp";
import { revalidateContent } from "@usegraft/sdk-next";
import { collections, functions } from "@/graft.config";
import { actor } from "@/lib/actor";
import { db } from "@/lib/graft";

export const POST = createGraftMcpHandler({
  contentDir: "./content",
  db,
  collections,
  functions,
  actor,
  // An agent's write lands in this app's process, so refresh the cache here.
  onContentChange: ({ branch, changes }) => {
    revalidateContent(branch, changes);
  },
});
