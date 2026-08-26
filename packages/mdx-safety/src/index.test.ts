import { describe, expect, it } from "vitest";
import { assertSafeMdx, findExecutableMdx } from "./index";

describe("findExecutableMdx", () => {
  it("accepts prose, Markdown and components with literal attributes", () => {
    const safe = [
      "# Heading\n\nSome **prose** with a [link](https://example.com).",
      "- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |",
      '<Callout tone="warn">Careful.</Callout>',
      '<Faq>\n\n<Item question="Why?">Because.</Item>\n\n</Faq>',
      "```ts\nconst x = process.env.SECRET;\n```",
    ];
    for (const source of safe) {
      expect(findExecutableMdx(source), source).toEqual([]);
    }
  });

  it("refuses expressions, imports and exports", () => {
    expect(findExecutableMdx("{process.env.SECRET}")[0]?.kind).toBe("expression");
    expect(findExecutableMdx("Inline {1 + 1} here.")[0]?.kind).toBe("expression");
    expect(findExecutableMdx('import fs from "node:fs";\n\nHi')[0]?.kind).toBe("import-or-export");
    expect(findExecutableMdx("export const x = 1;\n\nHi")[0]?.kind).toBe("import-or-export");
  });

  it("refuses expression attributes and spreads", () => {
    expect(findExecutableMdx("<Callout tone={process.env.X} />")[0]?.kind).toBe(
      "attribute-expression",
    );
    expect(findExecutableMdx("<Callout {...props} />")[0]?.kind).toBe("attribute-spread");
  });

  it("reports every offender, not just the first", () => {
    const found = findExecutableMdx("{a}\n\n{b}\n\n{c}");
    expect(found).toHaveLength(3);
  });

  it("reports where, so an author can find it", () => {
    const found = findExecutableMdx("# Title\n\nSome prose.\n\n{danger}");
    expect(found[0]?.line).toBe(5);
  });

  it("treats unparseable source as nothing to execute", () => {
    // A body that will not parse cannot run either, and the compile step
    // reports the syntax error with far better context than this would.
    expect(findExecutableMdx("<Unclosed")).toEqual([]);
  });
});

describe("assertSafeMdx", () => {
  it("passes safe content silently", () => {
    expect(() => assertSafeMdx("# Fine\n\nProse.")).not.toThrow();
  });

  it("throws a GraftError naming the construct and the fix", () => {
    let error: unknown;
    try {
      assertSafeMdx("{await import('node:child_process')}", { label: "pages/home" });
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      details: { found: 1 },
    });
    expect(String((error as { message: string }).message)).toContain("pages/home");
    expect(String((error as { fix: string }).fix)).toContain("code review");
  });
});
