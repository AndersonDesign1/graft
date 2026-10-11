import { createHash } from "node:crypto";

/**
 * The git blob SHA of some bytes: `sha1("blob <length>\0" + bytes)`.
 *
 * Used as the content version on every store, so a version read from disk and
 * one read from GitHub mean the same thing, and a remote store can know the
 * SHA of a blob it is about to create without asking for it back.
 */
export function gitBlobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
