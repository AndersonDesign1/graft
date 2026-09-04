import { describe, expect, it } from "vitest";
import { createStorage } from "./storage";

const baseConfig = {
  endpoint: "https://accountid.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "graft-assets",
};

describe("storage.url", () => {
  it("returns a stable public URL when publicBaseUrl is configured", async () => {
    const storage = createStorage({ ...baseConfig, publicBaseUrl: "https://assets.example.com/" });
    expect(await storage.url("pages/home/hero.svg")).toBe(
      "https://assets.example.com/pages/home/hero.svg",
    );
  });

  it("strips any number of trailing slashes on the public base", async () => {
    const storage = createStorage({
      ...baseConfig,
      publicBaseUrl: "https://assets.example.com////",
    });
    expect(await storage.url("pages/home/hero.svg")).toBe(
      "https://assets.example.com/pages/home/hero.svg",
    );
  });

  it("falls back to a presigned GET without publicBaseUrl", async () => {
    const storage = createStorage(baseConfig);
    const url = new URL(await storage.url("pages/home/hero.svg", { expiresIn: 60 }));
    expect(url.origin).toBe(baseConfig.endpoint);
    expect(url.pathname).toBe("/graft-assets/pages/home/hero.svg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("presignGet and presignPut sign for different methods", async () => {
    const storage = createStorage(baseConfig);
    const get = new URL(await storage.presignGet("a/b.png"));
    const put = new URL(await storage.presignPut("a/b.png"));
    expect(get.searchParams.get("X-Amz-Signature")).not.toBe(
      put.searchParams.get("X-Amz-Signature"),
    );
  });
});
