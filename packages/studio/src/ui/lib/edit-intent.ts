/**
 * Tells an editor whether a person has actually touched the document.
 *
 * Rich editors emit a change event as soon as they mount, because parsing and
 * re-serialising normalises the source — folding long frontmatter, dropping a
 * blank line, re-wrapping a table. Treated as an edit, that means *opening* a
 * document rewrites it, and with autosave on, browsing the content tree
 * quietly reformats every file you look at.
 *
 * So changes are ignored until one of these events proves a human is driving.
 * Deliberately DOM-only and editor-agnostic: the safety property is "no write
 * without an interaction", and that should not depend on which editor library
 * we happen to be using.
 */

/** The narrowest thing we need. Keeps this testable without a DOM. */
type Listenable = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * `beforeinput` covers typing, paste, drop and IME. `pointerdown` covers the
 * toolbar, slash menu and block handles, which mutate the document without an
 * input event ever firing. The rest are belt-and-braces for editors that
 * preventDefault their way around `beforeinput`.
 *
 * Over-triggering is safe — it only re-enables change events, and the save
 * path still compares content before writing (see `hasUnsavedChanges`).
 * Under-triggering silently drops the operator's work, so the list errs long.
 */
export const HUMAN_EDIT_EVENTS = [
  "beforeinput",
  "keydown",
  "paste",
  "drop",
  "cut",
  "pointerdown",
] as const;

export interface EditIntent {
  /** Has a human interacted with this node since it was mounted? */
  readonly touched: boolean;
  /** Detach the listeners. Safe to call twice. */
  dispose(): void;
}

/**
 * Capture phase: editors stop propagation on plenty of these, and a guard that
 * only fires for events the editor lets bubble is not a guard.
 *
 * Object form rather than the boolean shorthand — Node's EventTarget reads
 * `.capture` off an object and ignores a bare `true`, so `removeEventListener`
 * silently fails to match and the listener leaks.
 */
const CAPTURE = { capture: true } as const;

export function watchEditIntent(node: Listenable): EditIntent {
  let touched = false;
  const mark = (): void => {
    touched = true;
  };

  for (const type of HUMAN_EDIT_EVENTS) node.addEventListener(type, mark, CAPTURE);

  let disposed = false;
  return {
    get touched() {
      return touched;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const type of HUMAN_EDIT_EVENTS) node.removeEventListener(type, mark, CAPTURE);
    },
  };
}
