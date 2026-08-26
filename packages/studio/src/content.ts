/**
 * File-authoritative content read/write for Studio — same model as MCP:
 * git owns the MDX; compile refreshes the index.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  compile,
  composeDocument,
  parseDocument,
  writeDocumentFile,
  type ProjectedDoc,
  resolveContained,
  SLUG_RE,
} from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import type { Database } from "@usegraft/db";
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

  // Validate the slug's SHAPE, then contain the path it produces. The check in
  // parseDocument below does not help: it validates `basename(sourcePath)`,
  // which strips exactly the `..` segments that make a path dangerous, so
  // "../../../../tmp/pwn" reached writeDocumentFile as a clean-looking "pwn".
  if (!SLUG_RE.test(options.slug)) {
    throw new GraftError({
      code: "INVALID_SLUG",
      message: `Slug "${options.slug}" is not URL-safe.`,
      fix: 'Slugs are kebab-case: lowercase letters, digits and single hyphens, e.g. "getting-started". They name one document inside a collection, so they cannot contain "/", "\\" or "..".',
      details: { slug: options.slug, pattern: SLUG_RE.source },
    });
  }
  const sourcePath = `${options.collection}/${options.slug}.mdx`;
  const fullPath = resolveContained(options.contentDir, sourcePath, {
    label: "document",
    // The editor writes real files; a symlinked target would redirect the save
    // somewhere the author never chose.
  });
  // Preserve the author's frontmatter bytes when only the body changed —
  // re-serialising would rewrite their quoting and spacing on every save.
  const existingRaw = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : undefined;
  const raw = composeDocument(existingRaw, options.data, options.body ?? "");
  parseDocument(raw, collection, sourcePath);

  writeDocumentFile(fullPath, raw);

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
