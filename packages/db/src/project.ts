/**
 * Project a few documents without re-reading the branch.
 *
 * `projectBranchContent` makes the index match a whole tree, so it has to see
 * every document: whatever it is not given, it removes. A save or a publish of
 * one document needs the opposite: change that document's row and leave the
 * rest alone. This does that, and records a compilation like every projection,
 * so the audit trail still says what changed and from which commit.
 */
import { GraftError, type ChangeSet } from "@usegraft/contracts";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import type { ContentInput } from "./diff";
import { compilations, contentIndex } from "./schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DocumentChanges {
  /** Rows for the documents that exist now, validated by the caller. */
  upserts: ContentInput[];
  /** Documents to take off the index by key. */
  removals: Array<{ collection: string; slug: string }>;
  /**
   * The source files these changes cover. A live row read from one of them
   * that `upserts` no longer produces is removed: the file was deleted, or
   * its frontmatter `slug` changed.
   */
  paths: string[];
}

export interface ProjectDocumentsOptions {
  branchId?: string;
  /** Commit the files were read at; recorded in `compilations`. Null for revisions. */
  gitSha?: string | null;
}

/** Apply `changes` to one branch's index in a transaction of its own. */
export async function projectDocuments(
  db: Database,
  changes: DocumentChanges,
  options: ProjectDocumentsOptions = {},
): Promise<ChangeSet> {
  return db.transaction((tx) => projectDocumentsIn(tx, changes, options));
}

/** `projectDocuments` inside a caller's transaction, such as a publish. */
export async function projectDocumentsIn(
  tx: Tx,
  changes: DocumentChanges,
  options: ProjectDocumentsOptions = {},
): Promise<ChangeSet> {
  const branchId = options.branchId ?? "main";
  const result: ChangeSet = { added: [], changed: [], removed: [], unchanged: 0 };
  const keys = [...changes.upserts, ...changes.removals];
  const existing =
    keys.length === 0
      ? []
      : await tx
          .select({
            collection: contentIndex.collection,
            slug: contentIndex.slug,
            contentHash: contentIndex.contentHash,
            sourcePath: contentIndex.sourcePath,
            deleted: contentIndex.deleted,
          })
          .from(contentIndex)
          .where(
            and(
              eq(contentIndex.branchId, branchId),
              or(
                ...keys.map((key) =>
                  and(eq(contentIndex.collection, key.collection), eq(contentIndex.slug, key.slug)),
                ),
              ),
            ),
          );
  const byKey = new Map(existing.map((row) => [`${row.collection}/${row.slug}`, row]));

  // The index is keyed by slug, so a document claiming a slug another live
  // file holds would silently replace that file's row. A full compile refuses
  // the same thing as SLUG_NOT_UNIQUE; so does this, and the throw rolls back.
  for (const row of changes.upserts) {
    const prev = byKey.get(`${row.collection}/${row.slug}`);
    if (prev && !prev.deleted && prev.sourcePath !== row.sourcePath) {
      throw new GraftError({
        code: "SLUG_NOT_UNIQUE",
        message: `Slug "${row.slug}" in collection "${row.collection}" is used by both ${prev.sourcePath} and ${row.sourcePath}`,
        fix: "Give one a unique `slug` field, or rename the file. The index was not changed.",
        details: {
          slug: row.slug,
          collection: row.collection,
          files: [prev.sourcePath, row.sourcePath],
        },
      });
    }
  }

  for (const row of changes.upserts) {
    const key = `${row.collection}/${row.slug}`;
    const prev = byKey.get(key);
    if (!prev || prev.deleted) result.added.push(key);
    else if (prev.contentHash !== row.contentHash || prev.sourcePath !== row.sourcePath) {
      result.changed.push(key);
    } else {
      result.unchanged += 1;
      continue;
    }
    await tx
      .insert(contentIndex)
      .values({ ...row, branchId, deleted: false })
      .onConflictDoUpdate({
        target: [contentIndex.branchId, contentIndex.collection, contentIndex.slug],
        set: {
          data: sql`excluded.data`,
          body: sql`excluded.body`,
          contentHash: sql`excluded.content_hash`,
          sourcePath: sql`excluded.source_path`,
          deleted: false,
          updatedAt: sql`now()`,
        },
      });
  }
  for (const removal of changes.removals) {
    const key = `${removal.collection}/${removal.slug}`;
    const prev = byKey.get(key);
    if (!prev || prev.deleted) continue;
    result.removed.push(key);
    await tx
      .update(contentIndex)
      .set({ deleted: true, updatedAt: sql`now()` })
      .where(
        and(
          eq(contentIndex.branchId, branchId),
          eq(contentIndex.collection, removal.collection),
          eq(contentIndex.slug, removal.slug),
        ),
      );
  }

  const kept = new Set(changes.upserts.map((row) => `${row.collection}/${row.slug}`));
  const stale =
    changes.paths.length === 0
      ? []
      : await tx
          .select({ collection: contentIndex.collection, slug: contentIndex.slug })
          .from(contentIndex)
          .where(
            and(
              eq(contentIndex.branchId, branchId),
              eq(contentIndex.deleted, false),
              inArray(contentIndex.sourcePath, changes.paths),
            ),
          );
  for (const row of stale) {
    const key = `${row.collection}/${row.slug}`;
    if (kept.has(key)) continue;
    result.removed.push(key);
    await tx
      .update(contentIndex)
      .set({ deleted: true, updatedAt: sql`now()` })
      .where(
        and(
          eq(contentIndex.branchId, branchId),
          eq(contentIndex.collection, row.collection),
          eq(contentIndex.slug, row.slug),
        ),
      );
  }

  const [live] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contentIndex)
    .where(and(eq(contentIndex.branchId, branchId), eq(contentIndex.deleted, false)));
  await tx.insert(compilations).values({
    branchId,
    gitSha: options.gitSha ?? null,
    docCount: live?.n ?? 0,
    added: result.added.length,
    changed: result.changed.length,
    removed: result.removed.length,
  });
  return result;
}
