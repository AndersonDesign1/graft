/**
 * Moving through a list of entries from the keyboard: the arrow keys, Home
 * and End while focus is in the list, and j and k from anywhere on the page,
 * as in a mail client. Tab used to be the only way through a list, with two
 * stops per row.
 */

/** Where a key moves focus among `count` rows from `at` (-1: none focused), or null. */
export function nextRow(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  let next: number;
  if (key === "ArrowDown" || key === "j") next = at + 1;
  else if (key === "ArrowUp" || key === "k") next = at === -1 ? 0 : at - 1;
  else if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  else return null;
  return Math.max(0, Math.min(count - 1, next));
}

const OVERLAY = "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]";

/**
 * Typing in a field, or anywhere in a dialog or menu: j and k are letters
 * there, not moves, and a confirm dialog keeps focus. A row's checkbox is
 * part of the list, so they move from it.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    return Boolean(target.closest(OVERLAY));
  }
  return Boolean(target.closest(`input, textarea, select, ${OVERLAY}`));
}

/**
 * Move focus among the rows `selector` finds inside `container`. Returns
 * whether the key was used, so the caller can prevent its default.
 */
export function moveRowFocus(
  container: HTMLElement,
  selector: string,
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "target">,
): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  if ((event.key === "j" || event.key === "k") && isTyping(event.target)) return false;
  const rows = [...container.querySelectorAll<HTMLElement>(selector)];
  const active = document.activeElement;
  // The row holding focus: its link, or anything else in its table row, such
  // as the checkbox beside it.
  const at = rows.findIndex(
    (row) => row === active || row.contains(active) || Boolean(row.closest("tr")?.contains(active)),
  );
  const next = nextRow(event.key, at, rows.length);
  if (next === null) return false;
  rows[next]?.focus();
  rows[next]?.scrollIntoView({ block: "nearest" });
  return true;
}
