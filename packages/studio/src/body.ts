import { DEFAULT_MAX_BODY_BYTES, readBodyText } from "@usegraft/contracts";

/**
 * A request's JSON body, read under the 1 MiB ceiling every JSON route shares.
 * A body over it throws PAYLOAD_TOO_LARGE before the rest is read. A body that
 * is not JSON gives null, so each route keeps its own message for a bad shape.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export async function readJson(request: Request): Promise<JsonValue> {
  const text = await readBodyText(request, DEFAULT_MAX_BODY_BYTES);
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}
