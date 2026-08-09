/**
 * Compile authored content into the content_index.
 *
 * `readDocs` walks the content directory, maps each top-level folder to a registered
 * collection, validates every file, and enforces slug uniqueness — surfacing problems
 * as agent-actionable GraftErrors. `compile` then projects the result into Postgres via
 * @usegraft/db's atomic hash-diff projection and reports exactly what changed, recording
 * the git SHA it compiled from (the "git is authoritative" audit trail).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import { projectBranchContent, type ChangeSet, type Database } from "@usegraft/db";
import { parseDocument, type ProjectedDoc } from "./parse";

export interface CompileOptions {
  contentDir: string;
  collections: Record<string, AnyCollection>;
  db: Database;
  branchId?: string;
  /**
   * Git commit recorded with this compilation. Omit to auto-resolve from
   * `contentDir` (tolerant: records null outside a git repo); pass null to skip.
   */
  gitSha?: string | null;
  /**
   * Also remove index rows in collections this schema doesn't know. Off by
   * default: purging unknown collections is the signature of two projects
   * sharing one DATABASE_URL, so projection aborts with INDEX_OWNERSHIP
   * unless this is set (legitimate after a collection rename/delete).
   */
  pruneUnknown?: boolean;
}

export interface CompileResult {
  count: number;
  docs: ProjectedDoc[];
  /** What this run did to the index: added / changed / removed keys + unchanged count. */
  changes: ChangeSet;
  /** The commit the content tree was compiled from, when resolvable. */
  gitSha: string | null;
}

/** Read + validate the content tree into normalized docs. Pure of the database. */
export function readDocs(
  contentDir: string,
  collections: Record<string, AnyCollection>,
): ProjectedDoc[] {
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    throw new GraftError({
      code: "CONTENT_DIR_NOT_FOUND",
      message: `Content directory not found: ${contentDir}`,
      fix: `Create it (documents live at <contentDir>/<collection>/<slug>.mdx, e.g. content/pages/home.mdx) or pass the correct \`contentDir\` to compile().`,
      details: { contentDir, collections: Object.keys(collections) },
    });
  }

  const docs: ProjectedDoc[] = [];
  const seen = new Map<string, string>();

  for (const file of walk(contentDir)) {
    const sourcePath = relative(contentDir, file).split(sep).join("/");
    const segments = sourcePath.split("/");
    const collectionName = segments.length > 1 ? (segments[0] ?? "") : "";
    const collection = collections[collectionName];
    if (!collection) {
      const known = Object.keys(collections).join(", ") || "(none registered)";
      throw new GraftError({
        code: "COLLECTION_NOT_FOUND",
        message:
          segments.length > 1
            ? `No collection registered for "${collectionName}" (${sourcePath})`
            : `${sourcePath} sits at the content root; documents must live in a collection folder`,
        fix:
          segments.length > 1
            ? `Register it — defineCollection({ name: "${collectionName}", fields: { … } }) and pass it to compile() — or move the file into one of: ${known}.`
            : `Move it to <contentDir>/<collection>/${sourcePath}. Registered collections: ${known}.`,
        details: { sourcePath, collection: collectionName, registered: Object.keys(collections) },
      });
    }

    if (collection.authority === "db-authoritative") {
      throw new GraftError({
        code: "AUTHORITY_MISMATCH",
        message: `${sourcePath} is a file, but collection "${collectionName}" is db-authoritative — its records live in Postgres, not in the content tree.`,
        fix: `Remove the file and write the data through the collection's functions instead (insertRecord via a defineFunction mutation). Files are only for file-authoritative collections.`,
        details: { sourcePath, collection: collectionName, authority: collection.authority },
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
  const gitSha = options.gitSha === undefined ? resolveGitSha(options.contentDir) : options.gitSha;
  const changes = await projectBranchContent(
    options.db,
    docs.map((doc) => ({
      collection: doc.collection,
      slug: doc.slug,
      data: doc.data,
      body: doc.body,
      contentHash: doc.contentHash,
      sourcePath: doc.sourcePath,
    })),
    {
      branchId: options.branchId ?? "main",
      gitSha,
      knownCollections: Object.keys(options.collections),
      pruneUnknown: options.pruneUnknown,
    },
  );
  return { count: docs.length, docs, changes, gitSha };
}

/** HEAD commit of the repo containing `cwd`, or null (no git, no repo — never throws). */
export function resolveGitSha(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
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
