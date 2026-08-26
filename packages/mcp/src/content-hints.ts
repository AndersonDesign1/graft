/**
 * Content readers, wearing the MCP surface's guidance.
 *
 * The readers themselves live in @usegraft/compiler — three copies of them
 * existed, two byte-identical. What legitimately differs per surface is the
 * `fix`: telling an agent to call `write_content` is useless to a Studio user,
 * and this repo requires every GraftError to carry a fix its caller can act on.
 */
import { findDoc as findDocIn, requireCollection as requireCollectionIn } from "@usegraft/compiler";

/**
 * How the MCP surface tells an agent to fix a content miss. The shared readers
 * live in @usegraft/compiler; only the guidance is surface-specific.
 */
const MCP_HINTS = {
  listCollections: "see list_collections",
  authorDocument: "or author it with write_content.",
} as const;

export const requireCollection = (
  collections: Parameters<typeof requireCollectionIn>[0],
  name: string,
): ReturnType<typeof requireCollectionIn> => requireCollectionIn(collections, name, MCP_HINTS);

export const findDoc = (
  contentDir: string,
  collectionName: string,
  collection: Parameters<typeof findDocIn>[2],
  slug: string,
): ReturnType<typeof findDocIn> =>
  findDocIn(contentDir, collectionName, collection, slug, MCP_HINTS);
