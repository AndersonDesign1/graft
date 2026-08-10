/**
 * Insert a block into whichever rich editor is currently mounted.
 *
 * The ⌘K palette lives at the top of the app and the editor is several levels
 * below it, so this is a one-slot registry rather than a prop: exactly one
 * document is open at a time, its editor registers on mount and clears on
 * unmount, and the palette asks whether there is anything to insert into.
 *
 * Insertion goes through Crepe's `/` block menu for markdown structure —
 * headings, lists, tables — which is Milkdown's own feature and works well.
 * What it cannot know about is *this project's* components, which is the gap
 * this fills: the palette offers the components the project declared, and the
 * snippet each declaration carries is inserted verbatim.
 */

export type InsertFn = (mdx: string) => void;

let active: InsertFn | null = null;

/** Called by the editor on mount. Returns the teardown. */
export function registerInserter(fn: InsertFn): () => void {
  active = fn;
  return () => {
    // Only clear if we are still the current one: a remount for a new document
    // registers the replacement before the old instance tears down.
    if (active === fn) active = null;
  };
}

export function canInsert(): boolean {
  return active !== null;
}

export function insertBlock(mdx: string): boolean {
  if (!active) return false;
  active(mdx);
  return true;
}
