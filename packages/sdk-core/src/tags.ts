/**
 * Cache-tag contract (Phase 4). A compile emits a `ChangeSet`
 * (added/changed/removed keys); these pure helpers turn branch + collection +
 * slug into the cache tags that reads register and a recompile invalidates,
 * so refreshing content refreshes exactly the affected pages and nothing else.
 *
 * Framework-agnostic on purpose: `@usegraft/sdk-next` binds these to Next's
 * `revalidateTag`, but any cache keyed by string tags can use the same scheme.
 */
import type { ChangeSet } from "@usegraft/contracts";

/** Every Graft tag starts here, so an app can namespace or bulk-clear them. */
export const TAG_NAMESPACE = "graft";

/**
 * Next.js skips a cache tag longer than 256 characters, with a warning rather
 * than an error, and a skipped tag is never invalidated: the page stays stale.
 * A long slug (or branch) could reach that, so every tag is kept within it.
 */
export const MAX_TAG_LENGTH = 256;

/** FNV-1a, 32-bit, from a given offset basis: small, sync, and the same everywhere. */
function fnv1a(text: string, basis: number): string {
  let hash = basis;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A tag at most MAX_TAG_LENGTH long. A longer one keeps its readable start and
 * ends in a digest of the whole tag. Reads and invalidation both build tags
 * here, so they still agree, and two long tags sharing a digest only means one
 * extra page refreshes.
 */
function bounded(tag: string): string {
  if (tag.length <= MAX_TAG_LENGTH) return tag;
  const digest = fnv1a(tag, 0x811c9dc5) + fnv1a(tag, 0x01234567);
  return `${tag.slice(0, MAX_TAG_LENGTH - digest.length - 1)}#${digest}`;
}

/** Cache tag for one document — invalidated when that doc is added/changed/removed. */
export function documentTag(branch: string, collection: string, slug: string): string {
  return bounded(`${TAG_NAMESPACE}:${branch}:${collection}:${slug}`);
}

/** Cache tag for a collection's list/search reads — invalidated when ANY of its docs changes. */
export function collectionTag(branch: string, collection: string): string {
  return bounded(`${TAG_NAMESPACE}:${branch}:${collection}`);
}

/**
 * The tags a read should register. A single-document read (slug given)
 * registers its doc tag; a list or search read (no slug) registers the
 * collection tag. A document read of a slug that does not exist yet still
 * registers that slug's doc tag, so a later `added` for it invalidates the miss.
 */
export function tagsFor(branch: string, collection: string, slug?: string): string[] {
  return slug === undefined
    ? [collectionTag(branch, collection)]
    : [documentTag(branch, collection, slug)];
}

/**
 * The tags to invalidate for a compile's `ChangeSet`: each touched document's
 * doc tag (refreshes single-doc reads) plus its collection tag (refreshes list
 * and search reads). Unchanged docs are never invalidated — the point of the
 * hash-diff projection. Keys are `"<collection>/<slug>"`; slugs are kebab-case
 * (no slashes), so the split is on the first `/`.
 */
export function tagsForChanges(branch: string, changes: ChangeSet): string[] {
  const tags = new Set<string>();
  for (const key of [...changes.added, ...changes.changed, ...changes.removed]) {
    const slash = key.indexOf("/");
    if (slash === -1) {
      // Defensive: a malformed key with no slug still refreshes the collection.
      tags.add(collectionTag(branch, key));
      continue;
    }
    const collection = key.slice(0, slash);
    const slug = key.slice(slash + 1);
    tags.add(collectionTag(branch, collection));
    tags.add(documentTag(branch, collection, slug));
  }
  return [...tags];
}
