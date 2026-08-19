/**
 * Turning `git status` into the editor's language.
 *
 * The API answers in paths because that is what git knows. An editor thinks in
 * documents, so the drawer joins the change list against the content tree it
 * already has — the tree is filesystem-first, so anything on disk is in it,
 * including a document that has never been compiled.
 *
 * The join is here rather than on the server for one reason: the tree is
 * already loaded and already the Studio's model of "what a document is". A
 * second server-side notion of the same thing is how the two drift.
 *
 * Both axes travel together on purpose. A document can differ from git (needs
 * a commit) and differ from the index (needs a compile), and those are
 * genuinely independent — compiling does not commit, committing does not
 * compile. Showing one and hiding the other is how an operator ends up with a
 * published site that no commit records, or a commit no reader can see.
 */
import type { ChangeStatus, ChangedFileDto, ContentTree, DocumentState } from "../../types";

export interface ChangeRow {
  path: string;
  status: ChangeStatus;
  /** Previous path, on a rename. */
  from?: string;
  staged: boolean;
  /** The document this file is, when the tree knows it. */
  collection?: string;
  slug?: string;
  title?: string;
  /** Where it stands against the compiled index — the other axis. */
  indexState?: DocumentState;
}

export interface ChangeGroup {
  /** Null for files under the content directory that belong to no collection. */
  collection: string | null;
  rows: ChangeRow[];
}

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  added: "New",
  modified: "Edited",
  deleted: "Deleted",
  renamed: "Renamed",
};

/** Index by source path — the one key git and the tree already agree on. */
function documentIndex(tree: ContentTree | null) {
  const byPath = new Map<
    string,
    { collection: string; slug: string; title?: string; state: DocumentState }
  >();
  for (const collection of tree?.collections ?? []) {
    for (const doc of collection.documents) {
      byPath.set(doc.sourcePath, {
        collection: collection.name,
        slug: doc.slug,
        ...(doc.title ? { title: doc.title } : {}),
        state: doc.state,
      });
    }
  }
  return byPath;
}

export function toRows(files: readonly ChangedFileDto[], tree: ContentTree | null): ChangeRow[] {
  const byPath = documentIndex(tree);
  const collections = new Set((tree?.collections ?? []).map((collection) => collection.name));

  return files.map((file) => {
    const doc = byPath.get(file.path);
    if (doc) {
      return {
        path: file.path,
        status: file.status,
        staged: file.staged,
        ...(file.from ? { from: file.from } : {}),
        collection: doc.collection,
        slug: doc.slug,
        ...(doc.title ? { title: doc.title } : {}),
        indexState: doc.state,
      };
    }

    // A file the tree cannot know: deleted from disk and never indexed, or
    // something that is not a document at all. The first path segment still
    // places it when it names a real collection — worth doing, because a
    // deleted document is exactly the case where the operator most wants to
    // see which section it came from.
    const segment = file.path.split("/")[0];
    return {
      path: file.path,
      status: file.status,
      staged: file.staged,
      ...(file.from ? { from: file.from } : {}),
      ...(segment && collections.has(segment) ? { collection: segment } : {}),
    };
  });
}

/** Collections in the tree's own order, then everything else. */
export function groupRows(rows: readonly ChangeRow[], tree: ContentTree | null): ChangeGroup[] {
  const order = (tree?.collections ?? []).map((collection) => collection.name);
  const groups = new Map<string, ChangeRow[]>();

  for (const row of rows) {
    const key = row.collection ?? "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const rank = (name: string): number => {
    if (!name) return Number.MAX_SAFE_INTEGER; // uncollected files sort last
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };

  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([collection, groupRows_]) => ({ collection: collection || null, rows: groupRows_ }));
}

/** The label the drawer shows for a row: its title, else the file's name. */
export const rowLabel = (row: ChangeRow): string =>
  row.title ?? row.slug ?? (row.path.split("/").pop() as string);

/**
 * The prefilled commit message.
 *
 * Prefilled rather than generated: the operator can always overwrite it, and
 * a message is the one part of a commit that a machine cannot infer. What it
 * can do is save the common case — one document, one verb — from being typed
 * out every time.
 */
export function defaultCommitMessage(rows: readonly ChangeRow[]): string {
  if (rows.length === 0) return "";

  const verbs = new Set(rows.map((row) => row.status));
  const verb =
    verbs.size === 1 && verbs.has("added")
      ? "Add"
      : verbs.size === 1 && verbs.has("deleted")
        ? "Delete"
        : "Update";

  if (rows.length === 1) return `${verb} ${rowLabel(rows[0] as ChangeRow)}`;
  return `${verb} ${rows.length} content files`;
}
