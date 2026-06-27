import { describe, expect, it } from "vitest";
import { storageConfigFromEnv } from "./config";

describe("storageConfigFromEnv", () => {
  it("reads S3_* env into a config (region defaults to auto)", () => {
    const cfg = storageConfigFromEnv({
      S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
      S3_ACCESS_KEY: "ak",
      S3_SECRET_KEY: "sk",
      S3_BUCKET: "graft-assets",
    });
    expect(cfg).toEqual({
      endpoint: "https://acc.r2.cloudflarestorage.com",
      region: "auto",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      bucket: "graft-assets",
    });
  });

  it("throws a helpful error naming the first missing var", () => {
    expect(() => storageConfigFromEnv({ S3_ENDPOINT: "x" })).toThrow(/S3_ACCESS_KEY/);
  });
});
