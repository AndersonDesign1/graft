import { DEFAULT_MAX_BODY_BYTES, GraftError, readBodyText } from "@usegraft/contracts";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A request's JSON body, read under `limit` (1 MiB unless the deployment set
 * `maxBodyBytes`). A body over it throws PAYLOAD_TOO_LARGE before the rest is read. A body that
 * is not JSON gives null, so each route keeps its own message for a bad shape.
 */
export async function readJson(
  request: Request,
  limit: number = DEFAULT_MAX_BODY_BYTES,
): Promise<JsonValue> {
  try {
    const parsed: JsonValue = JSON.parse(await readBodyText(request, limit));
    return parsed;
  } catch (error) {
    // Too large is its own answer, 413. Malformed JSON and a client gone
    // mid-body are both an unreadable body, which each route answers with 400.
    if (error instanceof GraftError) throw error;
    return null;
  }
}

/**
 * The asset upload route's limit: a 10 MB file is about 13.4 MiB as base64,
 * plus the rest of the JSON. Higher than the JSON routes' 1 MiB, or Studio's
 * own 10 MB upload limit could never be reached.
 */
export const UPLOAD_BODY_BYTES = 14 * 1024 * 1024;
