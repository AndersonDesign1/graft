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

export type DraftMode = "rich" | "raw";

/** What was on disk when the document was opened. */
export interface LoadedDocument {
  data: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface DocumentDraft {
  mode: DraftMode;
  /** Frontmatter scalars, as edited. Keys are a subset of `loaded.data`. */
  fields: Record<string, string | number | boolean>;
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
  return Object.entries(draft.fields).some(([key, value]) => loaded.data[key] !== value);
}
