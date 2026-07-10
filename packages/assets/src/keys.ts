/**
 * Asset key + content-type helpers shared by every upload surface
 * (`graft asset put`, the MCP `put_asset` tool).
 */
import { basename, extname } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** MIME type inferred from a file path or asset key extension. */
export function contentTypeFor(fileOrKey: string): string {
  return CONTENT_TYPES[extname(fileOrKey).toLowerCase()] ?? "application/octet-stream";
}

/** Default key: assets/<lowercased filename>, sanitized to the asset-key alphabet. */
export function defaultKeyFor(file: string): string {
  const name = basename(file)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "");
  return `assets/${name}`;
}
