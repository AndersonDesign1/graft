/**
 * Strip every `char` from the end (or both ends) of `value`, without a
 * quantifier regex. `/\/+$/` on a configured URL is what CodeQL flags as
 * polynomial ReDoS; this is linear whatever the input.
 */
export function trimChar(value: string, char: string, ends: "end" | "both" = "end"): string {
  let start = 0;
  let end = value.length;
  if (ends === "both") while (start < end && value[start] === char) start += 1;
  while (end > start && value[end - 1] === char) end -= 1;
  return value.slice(start, end);
}

/** A URL or API base without trailing slashes, ready for `${base}/path`. */
export const withoutTrailingSlashes = (value: string): string => trimChar(value, "/");
