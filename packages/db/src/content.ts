/**
 * Content writes — operations against the content_index projection target.
 *
 * `projectBranchContent` makes one branch's index exactly match the compiled
 * input, but by contentHash diff instead of delete-all-rebuild: unchanged rows
 * keep their updated_at (so caches and "what changed" stay meaningful), missing
 * rows are soft-deleted via the `deleted` flag, and every run records a
 * `compilations` row (git SHA + counts) — all in a single transaction, so the
 * projection stays atomic and deterministic.
 */
import { and, eq, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { diffBranchContent, type ChangeSet, type ContentInput } from "./diff";
import { compilations, contentIndex } from "./schema";

export type { ChangeSet, ContentInput } from "./diff";

export interface ProjectOptions {
  branchId?: string;
  /** Git commit the content tree was compiled from; recorded in `compilations`. */
  gitSha?: string | null;
}

export async function projectBranchContent(
  db: Database,
  rows: ContentInput[],
  options: ProjectOptions = {},
): Promise<ChangeSet> {
  const branchId = options.branchId ?? "main";

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        collection: contentIndex.collection,
        slug: contentIndex.slug,
        contentHash: contentIndex.contentHash,
        sourcePath: contentIndex.sourcePath,
        deleted: contentIndex.deleted,
      })
      .from(contentIndex)
      .where(eq(contentIndex.branchId, branchId));

    const { changes, upserts, removals } = diffBranchContent(existing, rows);

    if (upserts.length > 0) {
      await tx
        .insert(contentIndex)
        .values(upserts.map((row) => ({ ...row, branchId, deleted: false })))
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

    if (removals.length > 0) {
      await tx
        .update(contentIndex)
        .set({ deleted: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(contentIndex.branchId, branchId),
            or(
              ...removals.map((r) =>
                and(eq(contentIndex.collection, r.collection), eq(contentIndex.slug, r.slug)),
              ),
            ),
          ),
        );
    }

    await tx.insert(compilations).values({
      branchId,
      gitSha: options.gitSha ?? null,
      docCount: rows.length,
      added: changes.added.length,
      changed: changes.changed.length,
      removed: changes.removed.length,
    });

    return changes;
  });
}
