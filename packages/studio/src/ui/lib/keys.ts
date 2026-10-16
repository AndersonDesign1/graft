/**
 * The command key as this keyboard labels it: ⌘ on a Mac, Ctrl elsewhere.
 * One place, so the header, Settings' list and tooltips never disagree.
 */
export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** A shortcut written inline: "⌘\\" on a Mac, "Ctrl+\\" elsewhere. */
export function shortcut(key: string): string {
  return MOD_KEY === "⌘" ? `⌘${key}` : `Ctrl+${key}`;
}
