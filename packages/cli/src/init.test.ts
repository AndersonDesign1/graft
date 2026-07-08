import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDocs } from "@graft/compiler";
import { GraftError } from "@graft/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { initCommand } from "./commands/init";
import { findConfig, loadConfig } from "./config";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package so the scaffolded config's `@graft/core` import resolves.
// Own subdir of .test-tmp: test files run in parallel and the integration
// suites keep their fixtures in sibling subdirs — never delete the parent.
const loadableTmp = resolve(here, "../.test-tmp/init-scaffold");

afterAll(() => {
  rmSync(loadableTmp, { recursive: true, force: true });
});

describe("initCommand", () => {
  it("scaffolds config, content, and llms.txt", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-init-"));
    try {
      const result = initCommand({ targetDir: dir });
      expect(result.created.sort()).toEqual(
        [
          "graft.config.ts",
          join("graft", "index.ts"),
          join("content", "pages", "home.mdx"),
          "llms.txt",
        ].sort(),
      );
      expect(readFileSync(join(dir, "graft.config.ts"), "utf8")).toContain("defineCollection");
      // The barrel is scaffolded so the config's `import … from "./graft"` resolves.
      expect(readFileSync(join(dir, "graft", "index.ts"), "utf8")).toContain("mergePrimitives");
      expect(readFileSync(join(dir, "llms.txt"), "utf8")).toContain("graft compile");
      expect(existsSync(join(dir, "content", "pages", "home.mdx"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to run twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-init-"));
    try {
      initCommand({ targetDir: dir });
      expect(() => initCommand({ targetDir: dir })).toThrowError(GraftError);
      try {
        initCommand({ targetDir: dir });
      } catch (error) {
        expect((error as GraftError).code).toBe("ALREADY_INITIALIZED");
        expect((error as GraftError).fix).toBeTruthy();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scaffolds a project that loads and whose content validates", async () => {
    const dir = join(loadableTmp, "init-load");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    initCommand({ targetDir: dir });
    const config = await loadConfig(findConfig(dir));
    expect(Object.keys(config.collections)).toEqual(["pages"]);

    // The scaffolded home.mdx must satisfy the scaffolded schema.
    const docs = readDocs(config.contentDir, config.collections);
    expect(docs.map((doc) => doc.slug)).toEqual(["home"]);
    expect(docs[0]?.data.title).toBe("Hello, Graft");
  });
});
