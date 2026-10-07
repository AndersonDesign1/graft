/**
 * The Next.js guide's code blocks are type-checked from guide/ (see
 * scripts/typecheck-guide.mjs), which only proves something while guide/ and
 * the page agree. This holds them together in both directions: every ts/tsx
 * block on the page appears verbatim in a guide/ file, and every guide/ file
 * carries a block from the page.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const guideDir = join(packageRoot, "guide");
const page = resolve(packageRoot, "../../examples/docs-site/content/docs/next.mdx");

/** Files that set the fixture up rather than copy the page. */
const SCAFFOLDING = new Set(["graft.config.ts"]);

const normalize = (text: string) => text.replaceAll("\r\n", "\n");

function codeBlocks(mdx: string): string[] {
  const blocks: string[] = [];
  const fence = /^```(ts|tsx)\n([\s\S]*?)^```$/gm;
  for (const match of normalize(mdx).matchAll(fence)) blocks.push(match[2] ?? "");
  return blocks;
}

function guideFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return guideFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const blocks = codeBlocks(readFileSync(page, "utf8"));
const files = guideFiles(guideDir).map((path) => ({
  name: relative(guideDir, path).replaceAll("\\", "/"),
  source: normalize(readFileSync(path, "utf8")),
}));

describe("the Next.js guide's code blocks", () => {
  it("are found on the page", () => {
    expect(blocks.length).toBeGreaterThan(5);
  });

  it.each(blocks.map((block) => [block.split("\n")[0], block]))(
    "each appears verbatim in guide/: %s",
    (_first, block) => {
      expect(files.some((file) => file.source.includes(block))).toBe(true);
    },
  );

  it.each(files.filter((file) => !SCAFFOLDING.has(file.name)).map((file) => [file.name, file]))(
    "guide/%s carries a block from the page",
    (_name, file) => {
      expect(blocks.some((block) => file.source.includes(block))).toBe(true);
    },
  );
});
