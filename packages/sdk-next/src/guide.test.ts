/**
 * The Next.js guide's code blocks are type-checked from guide/ (see
 * scripts/typecheck-guide.mjs and compat/), which only proves something while
 * guide/ and the page agree. This holds them together in both directions:
 * every ts/tsx block on the page is a guide/ file, and every guide/ file is a
 * block from the page, exactly. Containment is not enough: a file could keep
 * the block and add code, or a `// @ts-nocheck`, that changes what is checked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const guideDir = join(packageRoot, "guide");
const page = resolve(packageRoot, "../../examples/docs-site/content/docs/next.mdx");

/** Files that set the fixture up rather than copy the page. */
const SCAFFOLDING = new Set(["graft.config.ts"]);

/** Line endings and trailing whitespace are not part of what a reader copies. */
const normalize = (text: string) =>
  text
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();

function codeBlocks(mdx: string): string[] {
  const blocks: string[] = [];
  const fence = /^```(ts|tsx)\n([\s\S]*?)^```$/gm;
  for (const match of mdx.replaceAll("\r\n", "\n").matchAll(fence)) {
    blocks.push(normalize(match[2] ?? ""));
  }
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
const copies = files.filter((file) => !SCAFFOLDING.has(file.name));

describe("the Next.js guide's code blocks", () => {
  it("are found on the page", () => {
    expect(blocks.length).toBeGreaterThan(5);
  });

  it.each(blocks.map((block) => [block.split("\n")[0], block]))(
    "each is a guide/ file, exactly: %s",
    (_first, block) => {
      expect(copies.some((file) => file.source === block)).toBe(true);
    },
  );

  it.each(copies.map((file) => [file.name, file]))(
    "guide/%s is a block from the page, exactly",
    (_name, file) => {
      expect(blocks).toContain(file.source);
    },
  );

  it.each(files.map((file) => [file.name, file]))(
    "guide/%s does not switch the type checker off",
    (_name, file) => {
      expect(file.source).not.toMatch(/@ts-(nocheck|ignore|expect-error)/);
    },
  );
});
