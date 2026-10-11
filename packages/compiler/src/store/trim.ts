/**
 * Strip every `char` from the end (or both ends) of `value`, without a
 * quantifier regex. `/\/+$/` on a configured URL is what CodeQL flags as
 * polynomial ReDoS; this is linear whatever the input.
 */
export function trimChar(value: string, char: string, ends: "end" | "both" = "end"): string {
  if (char.length === 0) return value;
  let start = 0;
  let end = value.length;
  if (ends === "both") {
    while (end - start >= char.length && value.startsWith(char, start)) start += char.length;
  }
  while (end - start >= char.length && value.endsWith(char, end)) end -= char.length;
  return value.slice(start, end);
}

/** A URL or API base without trailing slashes, ready for `${base}/path`. */
export const withoutTrailingSlashes = (value: string): string => trimChar(value, "/");
