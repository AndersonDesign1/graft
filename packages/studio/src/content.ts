/**
 * Content lookups for Studio's developer views, with Studio's own wording for
 * a miss. Saves go through the editor service (server/editor-service.ts).
 */
import { requireCollection as requireCollectionIn } from "@usegraft/compiler";
import type { AnyCollection } from "@usegraft/core";

/**
 * How the Studio surface tells an operator to fix a content miss. The readers
 * themselves live in @usegraft/compiler — three copies of them existed, two
 * byte-identical, which is how a containment fix reaches one caller and misses
 * the rest. Only the guidance differs per surface.
 */
const STUDIO_HINTS = { authorDocument: "or create it in the editor." } as const;

export function requireCollection(
  collections: Record<string, AnyCollection>,
  name: string,
): AnyCollection {
  return requireCollectionIn(collections, name, STUDIO_HINTS);
}

export { readCollectionDocs } from "@usegraft/compiler";
