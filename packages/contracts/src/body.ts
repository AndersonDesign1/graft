/**
 * Reading a request body with a ceiling.
 *
 * `request.json()` and `request.text()` buffer whatever arrives, so one large
 * POST is held in memory before any check on it runs. Every surface that reads
 * a body (the functions route, MCP, Studio, `graft serve`'s Node adapter) reads
 * it through here instead, so the limit and the error are the same everywhere.
 *
 * The declared `Content-Length` is checked first, so an honest oversized
 * request is refused without reading a byte. The stream is then counted as it
 * arrives, so a client that lies about its length, or sends none, is cut off at
 * the limit rather than at the end of its body.
 */
import { GraftError } from "./errors";

/** The ceiling for a JSON API body: a function call, a Studio save. 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * The ceiling for an MCP request. Higher because `put_asset` carries a file as
 * base64, which is a third larger than the file. 32 MiB fits a 24 MB file.
 */
export const DEFAULT_MAX_MCP_BODY_BYTES = 32 * 1024 * 1024;

/**
 * A configured limit, checked once where a handler is built. `NaN`,
 * `Infinity` or a negative number would make every comparison against it
 * false, which is the same as having no limit at all, so they are refused.
 */
export function bodyLimit(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `maxBodyBytes must be a whole number of bytes, 0 or more. Got ${String(value)}.`,
      fix: "Pass a byte count such as 1048576 (1 MiB), or leave it unset for the default.",
      details: { maxBodyBytes: value },
    });
  }
  return limit;
}

/** The error every surface returns for a body over its limit. Serve it as 413. */
export function payloadTooLarge(limit: number): GraftError {
  return new GraftError({
    code: "PAYLOAD_TOO_LARGE",
    message: `The request body is larger than this endpoint accepts (${limit} bytes).`,
    fix: `Send a smaller body. A deployment that needs larger requests raises the limit with \`maxBodyBytes\` on the handler, or \`--max-body-bytes\` on graft serve.`,
    details: { limit },
  });
}

/**
 * The body as bytes, or a `PAYLOAD_TOO_LARGE` GraftError once it passes
 * `limit`. A request with no body gives an empty array.
 */
export async function readBodyBytes(request: Request, limit: number): Promise<Uint8Array> {
  bodyLimit(limit, limit);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw payloadTooLarge(limit);
  if (request.body === null) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      // Stop the upload: nothing past the limit is wanted.
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The body as UTF-8 text, under the same limit as `readBodyBytes`. */
export async function readBodyText(request: Request, limit: number): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(request, limit));
}
