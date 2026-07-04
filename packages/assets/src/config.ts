/**
 * Storage configuration, read from S3-compatible env vars.
 * Targets Cloudflare R2 by default; MinIO (docker) is the self-host alternative.
 */
export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Public base URL for the bucket (e.g. an R2 public/custom domain). When set,
   * `storage.url()` returns stable public URLs instead of presigned GETs.
   */
  publicBaseUrl?: string;
}

const REQUIRED = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] as const;

export function storageConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): StorageConfig {
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_KEY;
  const bucket = env.S3_BUCKET;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    const missing = REQUIRED.find((key) => !env[key]);
    throw new Error(`Missing required env ${missing}. Set it in .env (see .env.example).`);
  }

  return {
    endpoint,
    region: env.S3_REGION ?? "auto",
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: env.S3_PUBLIC_URL,
  };
}
