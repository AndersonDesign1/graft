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

/** Typing in a field, a menu or a dialog: j and k are letters there, not moves. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest("input, textarea, select, [role=dialog], [role=menu], [role=listbox]"),
  );
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
  const at = rows.findIndex((row) => row === active || row.contains(active));
  const next = nextRow(event.key, at, rows.length);
  if (next === null) return false;
  rows[next]?.focus();
  rows[next]?.scrollIntoView({ block: "nearest" });
  return true;
}
