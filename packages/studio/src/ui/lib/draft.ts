/**
 * Does this draft differ from the file we loaded?
 *
 * The second half of the autosave safety story. The editor already ignores its
 * own mount-time normalisation (see `watchEditIntent`), but a write is
 * destructive and this check is nearly free, so the save path verifies that
 * something actually differs rather than trusting a single guard.
 *
 * Autosave without this pair is how a CMS rewrites every document an operator
 * merely opened.
 */

import { sameValue } from "./schema-form";

export type DraftMode = "rich" | "raw";

/** What was on disk when the document was opened. */
export interface LoadedDocument {
  data: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface DocumentDraft {
  mode: DraftMode;
  /**
   * The frontmatter exactly as it would be written — the whole object, not a
   * patch. It used to be a scalar-only subset compared key by key, which could
   * not see a *removed* key (clearing an optional field) and compared nested
   * values by identity, so an asset field rebuilt on render always looked
   * edited. Composing first and comparing structurally answers both.
   */
  data: Record<string, unknown>;
  body: string;
  raw: string;
  loaded: LoadedDocument | null;
}

export function hasUnsavedChanges(draft: DocumentDraft): boolean {
  const { loaded } = draft;
  // Nothing loaded means nothing to compare against, and writing a document we
  // never read is exactly the destructive case this guard exists to prevent.
  if (!loaded) return false;

  // Raw mode round-trips the whole file, so the file is the comparison.
  if (draft.mode === "raw") return draft.raw !== loaded.raw;

  if (draft.body !== loaded.body) return true;
  return !sameValue(draft.data, loaded.data);
}

/** Identity of the document a draft was loaded from. */
export interface DocumentIdentity {
  collection: string;
  slug: string;
}

/** The PUT body a save sends, or null when there is nothing to write. */
export interface SavePayload extends DocumentIdentity {
  branch?: string;
  data?: Record<string, unknown>;
  body?: string;
  raw?: string;
}

/**
 * Build the save payload from one snapshot, so identity and content cannot
 * disagree.
 *
 * This is extracted for a reason. The editor previously took `collection` and
 * `slug` from the current route closure while taking the bytes from a ref, and
 * on an A -> B navigation React re-renders with route=B before the pending
 * flush runs — so document A's content was written to document B's path,
 * destroying it. Composing the payload from a single `identity` argument makes
 * that class of mismatch unrepresentable, and testable without a DOM.
 */
export function buildSavePayload(
  identity: DocumentIdentity,
  draft: DocumentDraft,
  branch?: string,
): SavePayload | null {
  if (!hasUnsavedChanges(draft)) return null;
  const base = { collection: identity.collection, slug: identity.slug, branch };
  return draft.mode === "raw"
    ? { ...base, raw: draft.raw }
    : { ...base, data: draft.data, body: draft.body };
}
