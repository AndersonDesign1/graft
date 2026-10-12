/**
 * Content readers, wearing the MCP surface's guidance.
 *
 * The readers themselves live in @usegraft/compiler — three copies of them
 * existed, two byte-identical. What legitimately differs per surface is the
 * `fix`: telling an agent to call `write_content` is useless to a Studio user,
 * and this repo requires every GraftError to carry a fix its caller can act on.
 */
import { GraftError } from "@usegraft/contracts";
import {
  findDoc as findDocIn,
  parseDocument,
  requireCollection as requireCollectionIn,
  type ContentStore,
  type StoreActor,
} from "@usegraft/compiler";
import type { AnyCollection } from "@usegraft/core";

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

/** The miss findDoc reports, for a store with no files to search. */
export function documentNotFound(collectionName: string, slug: string): GraftError {
  return new GraftError({
    code: "DOCUMENT_NOT_FOUND",
    message: `No document "${slug}" in collection "${collectionName}"`,
    fix: `Check the slug with list_content, ${MCP_HINTS.authorDocument}`,
    details: { collection: collectionName, slug },
  });
}

export const findDoc = (
  contentDir: string,
  collectionName: string,
  collection: Parameters<typeof findDocIn>[2],
  slug: string,
): ReturnType<typeof findDocIn> =>
  findDocIn(contentDir, collectionName, collection, slug, MCP_HINTS);

/**
 * The path a store keeps a document under: `<slug>.mdx`, `<slug>.md`, or a
 * file whose frontmatter claims the slug. Null when the store has none.
 */
export async function findStoredPath(
  store: Pick<ContentStore, "entries">,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
  actor: StoreActor,
): Promise<string | null> {
  const files = (await store.entries?.(`${collectionName}/`, actor)) ?? [];
  const named = files.find(
    (file) =>
      file.path === `${collectionName}/${slug}.mdx` || file.path === `${collectionName}/${slug}.md`,
  );
  if (named) return named.path;
  for (const file of files) {
    if (!/\.mdx?$/.test(file.path)) continue;
    try {
      if (parseDocument(file.raw, collection, file.path).slug === slug) return file.path;
    } catch {
      // A draft that does not parse claims no slug.
    }
  }
  return null;
}
