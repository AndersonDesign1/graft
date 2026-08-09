/**
 * Asset URL resolution — lazy for the same reason as lib/graft.ts: `next build`
 * must not need the S3_* env. Private bucket → presigned GETs (fine here: every
 * page is force-dynamic); set S3_PUBLIC_URL for stable public URLs instead.
 */
import { createStorage, type Storage } from "@usegraft/assets";
import type { AssetRef } from "@usegraft/core";

let storage: Storage | null = null;

export async function assetUrl(ref: AssetRef): Promise<string> {
  storage ??= createStorage();
  return storage.url(ref.key);
}
