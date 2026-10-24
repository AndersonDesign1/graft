/**
 * "Did you mean": the closest known name to what was typed, or nothing when
 * no name is close enough to be a typo rather than a different word.
 */

/** Edit distance where swapping two neighbouring letters costs one edit. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The one candidate `typed` is the start of, if there is exactly one;
 * otherwise the closest candidate within a third of the word's length (at
 * least two edits), or one that starts the typed word.
 */
export function closest(typed: string, candidates: readonly string[]): string | undefined {
  const extending = candidates.filter(
    (candidate) => typed.length >= 3 && candidate.startsWith(typed),
  );
  if (extending.length === 1) return extending[0];
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(typed, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === undefined) return undefined;
  const limit = Math.max(2, Math.floor(typed.length / 3));
  if (bestDistance <= limit) return best;
  return candidates.find((candidate) => candidate.length >= 3 && typed.startsWith(candidate));
}
