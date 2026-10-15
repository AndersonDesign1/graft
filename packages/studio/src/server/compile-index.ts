/**
 * Compile into whichever index this Studio has: the Postgres index, the
 * static engine's artifact, or none. Without an index there is nothing to
 * project, and a save is just the file it wrote.
 */
import { compile, compileStatic, type CompileResult, type ContentSource } from "@usegraft/compiler";
import type { AnyCollection } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import type { MdxTrust } from "@usegraft/mdx-safety";

export interface StudioIndex {
  db?: Database;
  staticIndexPath?: string;
}

export async function compileIndex(
  index: StudioIndex,
  input: {
    contentDir: string;
    collections: Record<string, AnyCollection>;
    mdxTrust?: MdxTrust;
    branchId: string;
    source?: ContentSource;
  },
): Promise<CompileResult | null> {
  if (index.db) return compile({ ...input, db: index.db });
  if (index.staticIndexPath) {
    return compileStatic({
      contentDir: input.contentDir,
      collections: input.collections,
      indexPath: index.staticIndexPath,
      ...(input.mdxTrust ? { mdxTrust: input.mdxTrust } : {}),
    });
  }
  return null;
}
