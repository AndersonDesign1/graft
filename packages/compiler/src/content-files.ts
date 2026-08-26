/**
 * Reading authored content off disk, once.
 *
 * Git is authoritative for authored content, so every surface that shows a
 * document — the compiler projecting a whole tree, MCP tools serving an agent,
 * the Studio serving an editor — reads the same files the same way. Three
 * copies of that logic existed, two of them byte-identical, which is how a
 * containment fix lands in one caller and misses the others.
 *
 * Surface-specific guidance rides in `hints` rather than forking the function:
 * a `fix` telling an agent to call `write_content` is wrong for a Studio user,
 * and the repo's own rule is that a GraftError must carry a fix the caller can
 * act on.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import { parseDocument, type ProjectedDoc } from "./parse";

/** How THIS surface tells a caller to do the thing the error is about. */
export interface ContentHints {
  /** How to see what collections exist, e.g. "see list_collections". */
  listCollections?: string;
  /** How to create a document, e.g. "author it with write_content". */
  authorDocument?: string;
}

/** Every `.md`/`.mdx` file under `dir`, recursively, in stable order. */
export function walkContentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkContentFiles(full));
    else if (/\.mdx?$/.test(name)) out.push(full);
  }
  return out.sort();
}

/** Resolve a registered collection, or throw a miss the caller can act on. */
export function requireCollection(
  collections: Record<string, AnyCollection>,
  name: string,
  hints: ContentHints = {},
): AnyCollection {
  const collection = collections[name];
  if (collection) return collection;

  const registered = Object.keys(collections);
  const known = registered.join(", ") || "(none registered)";
  const where = hints.listCollections ? ` (${hints.listCollections})` : "";
  throw new GraftError({
    code: "COLLECTION_NOT_FOUND",
    message: `No collection named "${name}" is registered`,
    fix: `Use one of the registered collections: ${known}${where}, or add defineCollection({ name: "${name}", … }) to the schema.`,
    details: { collection: name, registered },
  });
}

/** Parse every document in one collection's folder. Empty if it does not exist. */
export function readCollectionDocs(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
): ProjectedDoc[] {
  const dir = join(contentDir, collectionName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];

  const docs: ProjectedDoc[] = [];
  for (const file of walkContentFiles(dir)) {
    const sourcePath = relative(contentDir, file).split(sep).join("/");
    docs.push(parseDocument(readFileSync(file, "utf8"), collection, sourcePath));
  }
  return docs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Find one document by slug, or throw DOCUMENT_NOT_FOUND listing the real ones. */
export function findDoc(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
  hints: ContentHints = {},
): ProjectedDoc {
  const docs = readCollectionDocs(contentDir, collectionName, collection);
  const doc = docs.find((candidate) => candidate.slug === slug);
  if (doc) return doc;

  const slugs = docs.map((candidate) => candidate.slug);
  const author = hints.authorDocument ? ` ${hints.authorDocument}` : "";
  throw new GraftError({
    code: "DOCUMENT_NOT_FOUND",
    message: `No document "${slug}" in collection "${collectionName}"`,
    fix:
      slugs.length > 0
        ? `Existing slugs: ${slugs.join(", ")}. Use one of those,${author || " or create it."}`
        : `Collection "${collectionName}" has no documents yet —${author || " create the first one."}`,
    details: { collection: collectionName, slug, existing: slugs },
  });
}
