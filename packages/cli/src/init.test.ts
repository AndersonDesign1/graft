import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDocs } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { initCommand } from "./commands/init";
import { findConfig, loadConfig } from "./config";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package so the scaffolded config's `@usegraft/core` import resolves.
// Own subdir of .test-tmp: test files run in parallel and the integration
// suites keep their fixtures in sibling subdirs — never delete the parent.
const loadableTmp = resolve(here, "../.test-tmp/init-scaffold");

afterAll(() => {
  rmSync(loadableTmp, { recursive: true, force: true });
});

describe("initCommand", () => {
  it("scaffolds a static project by default — config, content, llms.txt, .gitignore", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-init-"));
    try {
      const result = initCommand({ targetDir: dir });
      expect(result.driver).toBe("static");
      expect(result.created.sort()).toEqual(
        [
          "graft.config.ts",
          join("graft", "index.ts"),
          join("content", "pages", "home.mdx"),
          "llms.txt",
          ".gitignore",
        ].sort(),
      );
      const config = readFileSync(join(dir, "graft.config.ts"), "utf8");
      expect(config).toContain("defineCollection");
      expect(config).toContain('export const index = "static"');
      // The barrel is scaffolded so the config's `import … from "./graft"` resolves.
      expect(readFileSync(join(dir, "graft", "index.ts"), "utf8")).toContain("mergePrimitives");
      expect(existsSync(join(dir, "content", "pages", "home.mdx"))).toBe(true);
      // The artifact is derived — it must never be committed.
      expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".graft/");
      // llms.txt teaches the static loop and the upgrade path, not DATABASE_URL.
      const llms = readFileSync(join(dir, "llms.txt"), "utf8");
      expect(llms).toContain("graft compile");
      expect(llms).toContain("NEEDS_DATABASE");
      expect(llms).not.toContain("DATABASE_URL in .env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scaffolds the Postgres tier with --postgres (no .gitignore, teaches DATABASE_URL)", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-init-pg-"));
    try {
      const result = initCommand({ targetDir: dir, driver: "postgres" });
      expect(result.driver).toBe("postgres");
      expect(result.created).not.toContain(".gitignore");
      expect(readFileSync(join(dir, "graft.config.ts"), "utf8")).toContain(
        'export const index = "postgres"',
      );
      const llms = readFileSync(join(dir, "llms.txt"), "utf8");
      expect(llms).toContain("DATABASE_URL");
      expect(llms).toContain("INDEX_OWNERSHIP");
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
