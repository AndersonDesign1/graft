/**
 * graft asset put — upload a binary to the asset store and print the
 * frontmatter reference. The "add image" path for agents and humans:
 * upload, paste the printed snippet into a document, compile.
 */
import { readFileSync, statSync } from "node:fs";
import {
  AssetKeyTakenError,
  contentTypeFor,
  createStorage,
  defaultKeyFor,
  storageConfigFromEnv,
  type Storage,
} from "@usegraft/assets";
import { GraftError } from "@usegraft/contracts";
import { loadProjectEnv } from "../config";

// Shared with the MCP put_asset tool — one inference/sanitization rule per store.
export { contentTypeFor, defaultKeyFor };

export interface AssetPutOptions {
  cwd: string;
  file: string;
  key?: string;
  /** Replace a binary already stored under the key. Without it, a taken key is ASSET_EXISTS. */
  overwrite?: boolean;
  /** The store to write to. Defaults to the one the S3_* env vars describe. */
  storage?: Storage;
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

  const storage = options.storage ?? storageFromEnv();
  const key = options.key ?? defaultKeyFor(options.file);

  // The same guard the MCP put_asset tool applies. The store keeps no version
  // history, so a reused key would replace a binary that published pages still
  // point at, with nothing to restore it from. exists() answers the common
  // case early. The put itself carries If-None-Match, so the store also refuses
  // a key taken by a concurrent upload, or when credentials cannot HEAD.
  const keyTaken = () =>
    new GraftError({
      code: "ASSET_EXISTS",
      message: `Asset key "${key}" already holds a binary.`,
      fix: "Pick a distinct key (the store keeps no version history), or pass --overwrite if replacing the existing binary is the actual intent.",
      details: { key },
    });
  const overwrite = options.overwrite === true;
  if (!overwrite && (await storage.exists(key))) throw keyTaken();

  const contentType = contentTypeFor(options.file);
  try {
    await storage.put(key, body, contentType, { ifAbsent: !overwrite });
  } catch (error) {
    if (error instanceof AssetKeyTakenError) throw keyTaken();
    throw error;
  }

  return { key, contentType, bytes: body.byteLength };
}

// Storage config comes from S3_* env vars; translate its plain Error into the
// agent-actionable shape.
function storageFromEnv(): Storage {
  try {
    return createStorage(storageConfigFromEnv());
  } catch (error) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: error instanceof Error ? error.message : String(error),
      fix: "Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET in the project's .env (any parent directory works).",
      details: { variables: ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] },
    });
  }
}
