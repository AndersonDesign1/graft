/**
 * An agent's request, in words a person can approve or deny without opening
 * its JSON. The card used to be titled with the function name alone
 * (`delete_content`), with what it would delete one click further in.
 */

/** What the request would do: "Delete products/wool-hat", or "Run archiveOrder". */
export function describeRequest(functionName: string, input: unknown): string {
  const fields = fieldsOf(input);
  if (
    functionName === "delete_content" &&
    typeof fields.collection === "string" &&
    typeof fields.slug === "string"
  ) {
    return `Delete ${fields.collection}/${fields.slug}`;
  }
  return `Run ${functionName}`;
}

/** The input's plain top-level values, at most four, for the card itself. */
export function inputSummary(input: unknown): Array<[string, string]> {
  return Object.entries(fieldsOf(input))
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean",
    )
    .slice(0, 4)
    .map(([key, value]) => [key, String(value)]);
}

function fieldsOf(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : {};
}
