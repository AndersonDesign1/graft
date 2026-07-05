/**
 * graft asset put — upload a binary to the asset store and print the
 * frontmatter reference. The "add image" path for agents and humans:
 * upload, paste the printed snippet into a document, compile.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { GraftError } from "@graft/contracts";
import { loadProjectEnv } from "../config";

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

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Default key: assets/<lowercased filename>, sanitized to the asset-key alphabet. */
export function defaultKeyFor(file: string): string {
  const name = basename(file)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "");
  return `assets/${name}`;
}

export interface AssetPutOptions {
  cwd: string;
  file: string;
  key?: string;
}

export interface AssetPutResult {
  key: string;
  contentType: string;
  bytes: number;
}

export async function assetPutCommand(options: AssetPutOptions): Promise<AssetPutResult> {
  loadProjectEnv(options.cwd);

  let body: Uint8Array;
  try {
    statSync(options.file);
    body = readFileSync(options.file);
  } catch {
    throw new GraftError({
      code: "DOCUMENT_NOT_FOUND",
      message: `File not found: ${options.file}`,
      fix: "Pass a path to an existing file: graft asset put <file> [key].",
      details: { file: options.file },
    });
  }

  // Storage config comes from S3_* env vars; translate its plain Error into
  // the agent-actionable shape.
  const { createStorage, storageConfigFromEnv } = await import("@graft/assets");
  let storage: ReturnType<typeof createStorage>;
  try {
    storage = createStorage(storageConfigFromEnv());
  } catch (error) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: error instanceof Error ? error.message : String(error),
      fix: "Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET in the project's .env (any parent directory works).",
      details: { variables: ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] },
    });
  }

  const key = options.key ?? defaultKeyFor(options.file);
  const contentType = contentTypeFor(options.file);
  await storage.put(key, body, contentType);

  return { key, contentType, bytes: body.byteLength };
}
