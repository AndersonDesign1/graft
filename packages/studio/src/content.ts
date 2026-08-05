/**
 * File-authoritative content read/write for Studio — same model as MCP:
 * git owns the MDX; compile refreshes the index.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { compile, parseDocument, type ProjectedDoc } from "@graft/compiler";
import { GraftError } from "@graft/contracts";
import type { AnyCollection } from "@graft/core";
import type { Database } from "@graft/db";
import matter from "gray-matter";

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
      fix: `Use one of: ${known}.`,
      details: { collection: name, registered: Object.keys(collections) },
    });
  }
  return collection;
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

export function findDoc(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
): ProjectedDoc {
  const docs = readCollectionDocs(contentDir, collectionName, collection);
  const doc = docs.find((candidate) => candidate.slug === slug);
  if (!doc) {
    throw new GraftError({
      code: "DOCUMENT_NOT_FOUND",
      message: `No document with slug "${slug}" in collection "${collectionName}"`,
      fix:
        docs.length > 0
          ? `Existing slugs: ${docs.map((d) => d.slug).join(", ")}.`
          : `Author the first document in "${collectionName}".`,
      details: { collection: collectionName, slug },
    });
  }
  return doc;
}

/** Raw file text for the editor (frontmatter + body as authored). */
export function readRawDocument(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
): { sourcePath: string; raw: string; data: Record<string, unknown>; body: string } {
  const doc = findDoc(contentDir, collectionName, collection, slug);
  const full = join(contentDir, ...doc.sourcePath.split("/"));
  const raw = readFileSync(full, "utf8");
  const parsed = matter(raw);
  return {
    sourcePath: doc.sourcePath,
    raw,
    data: parsed.data as Record<string, unknown>,
    body: parsed.content.replace(/^\n/, ""),
  };
}

export async function writeDocument(options: {
  contentDir: string;
  collections: Record<string, AnyCollection>;
  db: Database;
  branchId: string;
  collection: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
}): Promise<{ written: string; branch: string; gitSha: string | null }> {
  const collection = requireCollection(options.collections, options.collection);
  if (collection.authority === "db-authoritative") {
    throw new GraftError({
      code: "AUTHORITY_MISMATCH",
      message: `Collection "${options.collection}" is db-authoritative.`,
      fix: "Edit db-authoritative records through typed functions, not Studio file edit.",
    });
  }

  const sourcePath = `${options.collection}/${options.slug}.mdx`;
  const raw = matter.stringify(options.body ?? "", options.data);
  parseDocument(raw, collection, sourcePath);

  mkdirSync(join(options.contentDir, options.collection), { recursive: true });
  writeFileSync(join(options.contentDir, ...sourcePath.split("/")), raw);

  const result = await compile({
    contentDir: options.contentDir,
    collections: options.collections,
    db: options.db,
    branchId: options.branchId,
  });
  return {
    written: sourcePath,
    branch: options.branchId,
    gitSha: result.gitSha ?? null,
  };
}
