/**
 * Content writes — operations against the content_index projection target.
 *
 * `replaceBranchContent` is the productionized Spike A: a full rebuild of one branch's
 * rows inside a single transaction, so projection is atomic (a failure rolls back) and
 * deterministic (the resulting rows depend only on the input, not on prior state).
 */
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { contentIndex, type NewContentRow } from "./schema";

/** The fields a caller supplies per row; branch_id/deleted/updated_at are managed here. */
export type ContentInput = Omit<NewContentRow, "branchId" | "deleted" | "updatedAt">;

export async function replaceBranchContent(
  db: Database,
  rows: ContentInput[],
  branchId = "main",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(contentIndex).where(eq(contentIndex.branchId, branchId));
    if (rows.length > 0) {
      await tx.insert(contentIndex).values(rows.map((row) => ({ ...row, branchId })));
    }
  });
}
