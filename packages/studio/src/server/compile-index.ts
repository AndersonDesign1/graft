/**
 * Compile into whichever index this Studio has: the Postgres index, the
 * static engine's artifact, or none. Without an index there is nothing to
 * project, and a save is just the file it wrote. Given `paths`, Postgres
 * projects only those files; the static artifact is rebuilt whole, since it
 * has no one-document projection yet.
 */
import {
  compile,
  compileDocuments,
  compileStatic,
  type CompileResult,
  type ContentSource,
} from "@usegraft/compiler";
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
    /** The files a save wrote. Omitted, the whole tree is compiled. */
    paths?: string[];
    /**
     * False when the caller checked its change before writing: the static
     * artifact is rebuilt whole, and a reference already broken elsewhere in
     * the tree must not refuse a save that didn't break it.
     */
    references?: boolean;
  },
): Promise<CompileResult | null> {
  if (index.db) {
    const { paths, source, references: _references, ...rest } = input;
    if (paths) return compileDocuments({ ...rest, paths, db: index.db });
    return compile({ ...rest, ...(source ? { source } : {}), db: index.db });
  }
  if (index.staticIndexPath) {
    return compileStatic({
      contentDir: input.contentDir,
      collections: input.collections,
      indexPath: index.staticIndexPath,
      ...(input.mdxTrust ? { mdxTrust: input.mdxTrust } : {}),
      references: input.references,
    });
  }
  return null;
}
