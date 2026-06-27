/**
 * Compile authored content into the content_index.
 *
 * `readDocs` walks the content directory, maps each top-level folder to a registered
 * collection, validates every file, and enforces slug uniqueness — surfacing problems
 * as agent-actionable GraftErrors. `compile` then projects the result into Postgres via
 * @graft/db's atomic, deterministic full-rebuild.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { GraftError } from "@graft/contracts";
import type { Collection } from "@graft/core";
import { replaceBranchContent, type Database } from "@graft/db";
import { parseDocument, type ProjectedDoc } from "./parse";

export interface CompileOptions {
  contentDir: string;
  collections: Record<string, Collection>;
  db: Database;
  branchId?: string;
}

export interface CompileResult {
  count: number;
  docs: ProjectedDoc[];
}

/** Read + validate the content tree into normalized docs. Pure of the database. */
export function readDocs(
  contentDir: string,
  collections: Record<string, Collection>,
): ProjectedDoc[] {
  const docs: ProjectedDoc[] = [];
  const seen = new Map<string, string>();

  for (const file of walk(contentDir)) {
    const sourcePath = relative(contentDir, file).split(sep).join("/");
    const collectionName = sourcePath.split("/")[0] ?? "";
    const collection = collections[collectionName];
    if (!collection) {
      throw new GraftError({
        code: "COLLECTION_NOT_FOUND",
        message: `No collection registered for "${collectionName}" (${sourcePath})`,
        fix: `Register it: defineCollection({ name: "${collectionName}", fields: { … } }) and pass it to compile().`,
        details: { sourcePath, collection: collectionName },
      });
    }

    const doc = parseDocument(readFileSync(file, "utf8"), collection, sourcePath);
    const key = `${doc.collection}/${doc.slug}`;
    const existing = seen.get(key);
    if (existing) {
      throw new GraftError({
        code: "SLUG_NOT_UNIQUE",
        message: `Slug "${doc.slug}" in collection "${doc.collection}" is used by both ${existing} and ${sourcePath}`,
        fix: `Give one a unique \`slug\` in frontmatter, or rename the file.`,
        details: { slug: doc.slug, collection: doc.collection, files: [existing, sourcePath] },
      });
    }
    seen.set(key, sourcePath);
    docs.push(doc);
  }

  return docs.sort((a, b) =>
    a.collection === b.collection
      ? a.slug.localeCompare(b.slug)
      : a.collection.localeCompare(b.collection),
  );
}

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const docs = readDocs(options.contentDir, options.collections);
  await replaceBranchContent(
    options.db,
    docs.map((doc) => ({
      collection: doc.collection,
      slug: doc.slug,
      data: doc.data,
      body: doc.body,
      contentHash: doc.contentHash,
      sourcePath: doc.sourcePath,
    })),
    options.branchId ?? "main",
  );
  return { count: docs.length, docs };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.mdx?$/.test(name)) out.push(full);
  }
  return out.sort();
}
