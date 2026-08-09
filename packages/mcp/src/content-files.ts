/**
 * File-level content access for the MCP tools.
 *
 * Reads go straight to the MDX files, not the database — git is authoritative and
 * these tools must show an agent the truth it can edit. Scoped to one collection
 * folder so a broken document elsewhere in the tree doesn't block unrelated reads.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseDocument, type ProjectedDoc } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";

/** Resolve a registered collection or throw the agent-actionable miss. */
export function requireCollection(
  collections: Record<string, AnyCollection>,
  name: string,
): AnyCollection {
  const collection = collections[name];
  if (!collection) {
    const known = Object.keys(collections).join(", ") || "(none registered)";
    throw new GraftError({
      code: "COLLECTION_NOT_FOUND",
      message: `No collection named "${name}" is registered`,
      fix: `Use one of the registered collections: ${known} (see list_collections), or add defineCollection({ name: "${name}", … }) to the schema.`,
      details: { collection: name, registered: Object.keys(collections) },
    });
  }
  return collection;
}

/** Parse every document in one collection's folder. Empty if the folder doesn't exist yet. */
export function readCollectionDocs(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
): ProjectedDoc[] {
  const dir = join(contentDir, collectionName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];

  const docs: ProjectedDoc[] = [];
  for (const file of walk(dir)) {
    const sourcePath = relative(contentDir, file).split(sep).join("/");
    docs.push(parseDocument(readFileSync(file, "utf8"), collection, sourcePath));
  }
  return docs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Find one document by slug or throw DOCUMENT_NOT_FOUND with the real slugs listed. */
export function findDoc(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
): ProjectedDoc {
  const docs = readCollectionDocs(contentDir, collectionName, collection);
  const doc = docs.find((candidate) => candidate.slug === slug);
  if (!doc) {
    const slugs = docs.map((candidate) => candidate.slug);
    throw new GraftError({
      code: "DOCUMENT_NOT_FOUND",
      message: `No document with slug "${slug}" in collection "${collectionName}"`,
      fix:
        slugs.length > 0
          ? `Existing slugs: ${slugs.join(", ")}. Use one of those, or author the document with write_content.`
          : `Collection "${collectionName}" has no documents yet — author the first one with write_content.`,
      details: { collection: collectionName, slug, existing: slugs },
    });
  }
  return doc;
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
