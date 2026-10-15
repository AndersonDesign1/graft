/**
 * Which publishes go through a pull request instead of straight onto the
 * production branch, in a git-sourced project hosted on GitHub.
 *
 * Size alone is a weak signal: a one-word change to a price matters more than
 * two thousand new words in a blog post. So the rule has three parts, and any
 * one of them sends the whole publish to review.
 */
export interface ReviewRule {
  /** A deletion (which includes a rename) opens a pull request. Default true. */
  deletes?: boolean;
  /** Collections whose every change opens a pull request, like `legal`. */
  collections?: string[];
  /** A document whose change touches more lines than this opens one. Default 200. */
  overLines?: number;
}

export const DEFAULT_REVIEW_RULE: Readonly<Required<Pick<ReviewRule, "deletes" | "overLines">>> = {
  deletes: true,
  overLines: 200,
};

/**
 * Lines added plus lines removed, counted as a multiset difference. It never
 * undercounts a real diff by more than moved lines, which is close enough for
 * a threshold and needs no diff algorithm.
 */
export function changedLines(before: string | null, after: string | null): number {
  const counts = new Map<string, number>();
  for (const line of (before ?? "").split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  for (const line of (after ?? "").split("\n")) counts.set(line, (counts.get(line) ?? 0) - 1);
  let total = 0;
  for (const n of counts.values()) total += Math.abs(n);
  return total;
}

/** Why this change needs review under the rule, or null when it may go straight live. */
export function reviewReason(
  rule: ReviewRule | false,
  change: { path: string; before: string | null; after: string | null },
): string | null {
  if (rule === false) return null;
  const deletes = rule.deletes ?? DEFAULT_REVIEW_RULE.deletes;
  const overLines = rule.overLines ?? DEFAULT_REVIEW_RULE.overLines;
  const collection = change.path.split("/")[0] ?? "";
  if (deletes && change.after === null && change.before !== null) {
    return `${change.path} is deleted`;
  }
  if (rule.collections?.includes(collection)) {
    return `${collection} changes are always reviewed`;
  }
  const lines = changedLines(change.before, change.after);
  if (lines > overLines) return `${change.path} changes ${lines} lines (over ${overLines})`;
  return null;
}
