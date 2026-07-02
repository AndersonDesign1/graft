/**
 * Pure content-diff logic — what changed between the rows already in the index
 * and the freshly compiled input. Kept free of SQL so the classification
 * (added / changed / removed / unchanged) is deterministic and unit-testable;
 * projectBranchContent applies the result transactionally.
 */
import type { NewContentRow } from "./schema";

/** The fields a caller supplies per row; branch_id/deleted/updated_at are managed by the db layer. */
export type ContentInput = Omit<NewContentRow, "branchId" | "deleted" | "updatedAt">;

/** The slice of an existing index row the diff needs. */
export interface ExistingContentState {
  collection: string;
  slug: string;
  contentHash: string;
  sourcePath: string;
  deleted: boolean;
}

/** What a projection run did, keyed by "collection/slug". */
export interface ChangeSet {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
}

export interface ContentDiff {
  changes: ChangeSet;
  /** Rows to insert-or-update (new, hash-changed, or resurrected). */
  upserts: ContentInput[];
  /** (collection, slug) pairs to soft-delete. */
  removals: Array<{ collection: string; slug: string }>;
}

const key = (row: { collection: string; slug: string }): string => `${row.collection}/${row.slug}`;

export function diffBranchContent(
  existing: ExistingContentState[],
  incoming: ContentInput[],
): ContentDiff {
  const existingByKey = new Map(existing.map((row) => [key(row), row]));
  const incomingKeys = new Set(incoming.map(key));

  const changes: ChangeSet = { added: [], changed: [], removed: [], unchanged: 0 };
  const upserts: ContentInput[] = [];
  const removals: Array<{ collection: string; slug: string }> = [];

  for (const row of incoming) {
    const prev = existingByKey.get(key(row));
    if (!prev || prev.deleted) {
      changes.added.push(key(row));
      upserts.push(row);
    } else if (prev.contentHash !== row.contentHash || prev.sourcePath !== row.sourcePath) {
      changes.changed.push(key(row));
      upserts.push(row);
    } else {
      changes.unchanged += 1;
    }
  }

  for (const [k, prev] of existingByKey) {
    if (!prev.deleted && !incomingKeys.has(k)) {
      changes.removed.push(k);
      removals.push({ collection: prev.collection, slug: prev.slug });
    }
  }

  return { changes, upserts, removals };
}
