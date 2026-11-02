/**
 * The per-branch scope memo behind `createDbIndexReader`. Kept out of the
 * package's exports, and apart from the reader so it is tested without a
 * database.
 */
import type { BranchScope } from "./branch";

/**
 * One in-flight or settled scope lookup per branch, shared by concurrent
 * reads. A reader is typically request-scoped (sdk-next dedupes via
 * React.cache), so a topology change is picked up by the next reader.
 *
 * A failed lookup is forgotten, so a reader that outlives one request (a Nuxt
 * or Nitro server keeps one per process) recovers from a database blip on the
 * next read instead of failing every read until it restarts.
 */
export function memoizeScopes(
  resolve: (branch: string) => Promise<BranchScope>,
): (branch: string) => Promise<BranchScope> {
  const cache = new Map<string, Promise<BranchScope>>();
  return (branch) => {
    const cached = cache.get(branch);
    if (cached !== undefined) return cached;
    const resolving = resolve(branch);
    cache.set(branch, resolving);
    resolving.catch(() => {
      if (cache.get(branch) === resolving) cache.delete(branch);
    });
    return resolving;
  };
}
