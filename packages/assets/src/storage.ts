/**
 * S3-compatible object storage (Cloudflare R2 / MinIO) via SigV4 (aws4fetch).
 *
 * Path-style addressing (`<endpoint>/<bucket>/<key>`) keeps R2 and MinIO happy.
 * This is the binary store; asset *metadata* is indexed in Postgres by the compiler.
 */
import { AwsClient } from "aws4fetch";
import { storageConfigFromEnv, type StorageConfig } from "./config";

export interface PresignOptions {
  expiresIn?: number;
}

export interface Storage {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A presigned PUT URL so a client (or agent) can upload directly. */
  presignPut(key: string, options?: PresignOptions): Promise<string>;
  /** A presigned GET URL for reading from a private bucket. */
  presignGet(key: string, options?: PresignOptions): Promise<string>;
  /**
   * A renderable URL for the key: stable public URL when `publicBaseUrl` is
   * configured, otherwise a presigned GET (default 900s expiry).
   */
  url(key: string, options?: PresignOptions): Promise<string>;
}

export function createStorage(config: StorageConfig = storageConfigFromEnv()): Storage {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    service: "s3",
  });
  const base = `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}`;
  const urlFor = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const presign = async (key: string, method: "GET" | "PUT", options: PresignOptions) => {
    const url = new URL(urlFor(key));
    url.searchParams.set("X-Amz-Expires", String(options.expiresIn ?? 900));
    const signed = await aws.sign(url.toString(), { method, aws: { signQuery: true } });
    return signed.url;
  };

  return {
    async put(key, body, contentType) {
      const res = await aws.fetch(urlFor(key), {
        method: "PUT",
        body,
        headers: contentType ? { "content-type": contentType } : undefined,
      });
      if (!res.ok) throw new Error(`storage put failed (${res.status}): ${await res.text()}`);
    },
    async get(key) {
      const res = await aws.fetch(urlFor(key));
      if (!res.ok) throw new Error(`storage get failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await aws.fetch(urlFor(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`storage delete failed (${res.status})`);
    },
    async exists(key) {
      const res = await aws.fetch(urlFor(key), { method: "HEAD" });
      return res.ok;
    },
    async presignPut(key, options = {}) {
      return presign(key, "PUT", options);
    },
    async presignGet(key, options = {}) {
      return presign(key, "GET", options);
    },
    async url(key, options = {}) {
      if (config.publicBaseUrl) {
        const publicBase = config.publicBaseUrl.replace(/\/+$/, "");
        return `${publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
      }
      return presign(key, "GET", options);
    },
  };
}
