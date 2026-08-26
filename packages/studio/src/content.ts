/**
 * File-authoritative content read/write for Studio — same model as MCP:
 * git owns the MDX; compile refreshes the index.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compile,
  composeDocument,
  findDoc as findDocIn,
  parseDocument,
  requireCollection as requireCollectionIn,
  resolveContained,
  SLUG_RE,
  writeDocumentFile,
  type ProjectedDoc,
} from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { assertSafeMdx } from "@usegraft/mdx-safety";
import type { AnyCollection } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import matter from "gray-matter";

/**
 * How the Studio surface tells an operator to fix a content miss. The readers
 * themselves live in @usegraft/compiler — three copies of them existed, two
 * byte-identical, which is how a containment fix reaches one caller and misses
 * the rest. Only the guidance differs per surface.
 */
const STUDIO_HINTS = { authorDocument: "or create it in the editor." } as const;

export function requireCollection(
  collections: Record<string, AnyCollection>,
  name: string,
): AnyCollection {
  return requireCollectionIn(collections, name, STUDIO_HINTS);
}

export function findDoc(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
): ProjectedDoc {
  return findDocIn(contentDir, collectionName, collection, slug, STUDIO_HINTS);
}

export { readCollectionDocs } from "@usegraft/compiler";

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
  // Same trust boundary as MCP write_content: a Studio save is content the
  // operator may not have written, and rendering evaluates MDX as JavaScript.
  assertSafeMdx(options.body ?? "", { label: `${options.collection}/${options.slug}` });

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
