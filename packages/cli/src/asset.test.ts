import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetKeyTakenError, type Storage } from "@usegraft/assets";
import { GraftError } from "@usegraft/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetPutCommand, contentTypeFor, defaultKeyFor } from "./commands/asset";

describe("contentTypeFor", () => {
  it.each([
    ["hero.svg", "image/svg+xml"],
    ["photo.JPG", "image/jpeg"],
    ["doc.pdf", "application/pdf"],
    ["blob.bin", "application/octet-stream"],
  ])("%s → %s", (file, expected) => {
    expect(contentTypeFor(file)).toBe(expected);
  });
});

describe("defaultKeyFor", () => {
  it("prefixes assets/ and sanitizes to the asset-key alphabet", () => {
    expect(defaultKeyFor(join("pics", "My Hero!.PNG"))).toBe("assets/my-hero-.png");
    expect(defaultKeyFor("hero.svg")).toBe("assets/hero.svg");
  });
});

describe("assetPutCommand failures", () => {
  it("throws DOCUMENT_NOT_FOUND for a missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-asset-"));
    try {
      await assetPutCommand({ cwd: dir, file: join(dir, "nope.png") });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as GraftError).code).toBe("DOCUMENT_NOT_FOUND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ENV_VAR_MISSING with the S3 fix when storage env is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-asset-"));
    const saved: Record<string, string | undefined> = {};
    for (const name of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    try {
      writeFileSync(join(dir, "some.png"), "x");
      await assetPutCommand({ cwd: dir, file: join(dir, "some.png") });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as GraftError).code).toBe("ENV_VAR_MISSING");
      expect((error as GraftError).fix).toContain("S3_ENDPOINT");
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value !== undefined) process.env[name] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * An in-memory store: enough of Storage for put/exists. `blindExists` makes
 * exists() always answer false, as a HEAD does for a credential that may upload
 * but not read, so only the conditional put stands between a key and a reuse.
 */
function memoryStorage(
  initial: Record<string, string> = {},
  { blindExists = false } = {},
): Storage & {
  objects: Map<string, Uint8Array | string>;
} {
  const objects = new Map<string, Uint8Array | string>(Object.entries(initial));
  const unused = () => Promise.reject(new Error("not used by asset put"));
  return {
    objects,
    put: async (key, body, _contentType, options) => {
      if (options?.ifAbsent && objects.has(key)) throw new AssetKeyTakenError(key);
      objects.set(key, body);
    },
    exists: async (key) => !blindExists && objects.has(key),
    get: unused,
    delete: unused,
    presignPut: unused,
    presignGet: unused,
    url: unused,
  };
}

describe("assetPutCommand key guard", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graft-asset-"));
    file = join(dir, "hero.png");
    writeFileSync(file, "new bytes");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uploads to a free key", async () => {
    const storage = memoryStorage();
    const result = await assetPutCommand({ cwd: dir, file, storage });
    expect(result).toEqual({ key: "assets/hero.png", contentType: "image/png", bytes: 9 });
    expect(storage.objects.has("assets/hero.png")).toBe(true);
  });

  it("refuses a taken key with ASSET_EXISTS and leaves the stored binary alone", async () => {
    const storage = memoryStorage({ "assets/hero.png": "old bytes" });
    try {
      await assetPutCommand({ cwd: dir, file, storage });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as GraftError).code).toBe("ASSET_EXISTS");
      expect((error as GraftError).fix).toContain("--overwrite");
      expect((error as GraftError).details).toEqual({ key: "assets/hero.png" });
    }
    expect(storage.objects.get("assets/hero.png")).toBe("old bytes");
  });

  it("checks an explicit key too", async () => {
    const storage = memoryStorage({ "pages/home/hero.png": "old bytes" });
    await expect(
      assetPutCommand({ cwd: dir, file, key: "pages/home/hero.png", storage }),
    ).rejects.toMatchObject({ code: "ASSET_EXISTS" });
  });

  it("still refuses a taken key when exists() cannot see it, because the put is conditional", async () => {
    const storage = memoryStorage({ "assets/hero.png": "old bytes" }, { blindExists: true });
    await expect(assetPutCommand({ cwd: dir, file, storage })).rejects.toMatchObject({
      code: "ASSET_EXISTS",
    });
    expect(storage.objects.get("assets/hero.png")).toBe("old bytes");
  });

  it("replaces a taken key with overwrite", async () => {
    const storage = memoryStorage({ "assets/hero.png": "old bytes" });
    await assetPutCommand({ cwd: dir, file, storage, overwrite: true });
    expect(new TextDecoder().decode(storage.objects.get("assets/hero.png") as Uint8Array)).toBe(
      "new bytes",
    );
  });
});
