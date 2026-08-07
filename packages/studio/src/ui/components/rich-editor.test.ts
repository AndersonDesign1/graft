/**
 * The MDX guard decides whether a document is safe to open in the rich
 * editor. A false negative rewrites someone's components into plain text on
 * the next autosave, so these lean hard on the side of refusing.
 */
import { describe, expect, it } from "vitest";
import { hasMdxSyntax } from "./rich-editor";

describe("hasMdxSyntax", () => {
  it("passes plain markdown", () => {
    const body = [
      "# Heading",
      "",
      "Some **bold** text with a [link](/docs).",
      "",
      "- one",
      "- two",
      "",
      "> a quote",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    expect(hasMdxSyntax(body)).toBe(false);
  });

  it("catches JSX components", () => {
    expect(hasMdxSyntax("<Callout>note</Callout>")).toBe(true);
    expect(hasMdxSyntax("<DocCards />")).toBe(true);
    expect(hasMdxSyntax("text\n\n<Foo.Bar prop='x' />\n")).toBe(true);
  });

  it("catches ESM import/export", () => {
    expect(hasMdxSyntax("import { Callout } from './x';\n\n# Title")).toBe(true);
    expect(hasMdxSyntax("export const meta = 1;\n")).toBe(true);
  });

  it("catches expression braces", () => {
    expect(hasMdxSyntax("The answer is {2 + 2}.")).toBe(true);
  });

  it("ignores angle brackets and braces inside code", () => {
    // Shell redirects, generics and object literals in fences are not MDX.
    const fenced = ["```ts", "const x: Array<string> = [];", "const y = { a: 1 };", "```"].join(
      "\n",
    );
    expect(hasMdxSyntax(fenced)).toBe(false);
    expect(hasMdxSyntax("Run `graft serve > log.txt` to capture output.")).toBe(false);
  });

  it("does not trip on plain autolinks or lowercase html", () => {
    // Lowercase tags are commonmark-representable; only capitalised JSX is not.
    expect(hasMdxSyntax("See <https://example.com> for more.")).toBe(false);
    expect(hasMdxSyntax("A line with <br /> in it.")).toBe(false);
  });
});
