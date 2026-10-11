/**
 * Slugs, shared by the server and the browser.
 *
 * Written as one pass instead of `.replace(/^-+|-+$/g, "")`: that regex is
 * polynomial on a run of dashes, and a title is request input.
 */

/** "Blue Linen Shirt!" -> "blue-linen-shirt". Empty when nothing is left. */
export function slugify(text: string, max = 80): string {
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  let out = "";
  for (const char of plain) {
    if (out.length >= max) break;
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) out += char;
    else if (out !== "" && !out.endsWith("-")) out += "-";
  }
  return out.endsWith("-") ? out.slice(0, -1) : out;
}
