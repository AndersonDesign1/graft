import { createGraftMcpHandler } from "@usegraft/mcp";
import { collections, functions } from "@/graft.config";
import { actor } from "@/lib/actor";
import { db } from "@/lib/graft";

export const POST = createGraftMcpHandler({
  contentDir: "./content",
  db,
  collections,
  functions,
  actor,
});
