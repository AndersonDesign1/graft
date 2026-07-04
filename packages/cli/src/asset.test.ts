import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@graft/contracts";
import { describe, expect, it } from "vitest";
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
