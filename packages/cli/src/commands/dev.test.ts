import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStaticIndex } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { announce, devCommand } from "./dev";
import { initCommand } from "./init";

describe("announce", () => {
  it("says nothing when nothing was published", () => {
    expect(announce([])).toEqual([]);
  });

  it("names who published what, once each, and the command to run", () => {
    expect(
      announce([
        { path: "posts/spring-sale.mdx", version: "a", publishedBy: "Ana" },
        { path: "posts/spring-sale.mdx", version: "b", publishedBy: "Ana" },
        { path: "pages/old.mdx", version: null, publishedBy: "Ben" },
      ]),
    ).toEqual([
      "Ana published posts/spring-sale.",
      "Ben published pages/old (deleted).",
      "Run graft pull to bring it into your files.",
    ]);
  });
});

describe("graft dev -- <command>", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // Inside the package so the scaffolded config's `@usegraft/core` import resolves.
  const projectDir = resolve(here, "../../.test-tmp/dev");
  const indexPath = join(projectDir, ".graft", "index.db");

  beforeAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(projectDir, { recursive: true });
    initCommand({ targetDir: projectDir });
  });
  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  /** The command graft dev runs: Node with this script, as a dev server would be. */
  const node = (script: string) => [process.execPath, "-e", script];

  it("starts the command after the first compile, and ends with its exit code", async () => {
    const code = await devCommand({
      cwd: projectDir,
      command: node(
        `process.exit(require("node:fs").existsSync(${JSON.stringify(indexPath)}) ? 3 : 4)`,
      ),
    });
    expect(code).toBe(3);
  });

  it("recompiles while the command runs, so an edit reaches the index it reads", async () => {
    // Edit a document, then exit once the index file is replaced.
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const index = ${JSON.stringify(indexPath)};
      const doc = path.join(${JSON.stringify(projectDir)}, "content/pages/home.mdx");
      fs.watch(path.dirname(index), (_event, name) => {
        if (name === path.basename(index)) process.exit(0);
      });
      fs.writeFileSync(doc, fs.readFileSync(doc, "utf8").replace(/^title: .*$/m, "title: Edited live"));
    `;
    expect(await devCommand({ cwd: projectDir, command: node(script) })).toBe(0);

    const index = await openStaticIndex(indexPath);
    try {
      const [home] = await index.readContent({ collection: "pages", slug: "home" });
      expect(home?.data.title).toBe("Edited live");
    } finally {
      await index.close();
    }
  });

  it("ends with 127 and a fix when the command cannot start", async () => {
    expect(await devCommand({ cwd: projectDir, command: ["graft-no-such-command"] })).toBe(127);
  });
});
