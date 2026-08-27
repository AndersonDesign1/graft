import { describe, expect, it } from "vitest";
import { assertSafeMdx, findExecutableMdx, UncheckableMdxError } from "./index";

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

describe("non-expression execution", () => {
  it("refuses elements that load or run code", () => {
    // No `{}` anywhere, so the expression checks never see these — and MDX
    // renders an unknown lowercase tag straight through to HTML.
    for (const source of [
      "<script>alert(1)</script>",
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x.swf"></object>',
      '<base href="https://evil.example/" />',
    ]) {
      expect(findExecutableMdx(source)[0]?.kind, source).toBe("scripting-element");
    }
  });

  it("refuses HTML-style void elements too, by failing to parse them", () => {
    // `<base href="…">` without a self-close is not valid MDX. It is still
    // refused — just as unparseable rather than as recognised — which is the
    // point of failing closed on a parse error.
    expect(() => findExecutableMdx('<base href="https://evil.example/">')).toThrowError(
      UncheckableMdxError,
    );
  });

  it("refuses inline event handlers, even with a string value", () => {
    const found = findExecutableMdx('<img src="x" onerror="fetch(\'//evil.example\')" />');
    expect(found[0]?.kind).toBe("event-handler");
  });

  it("leaves ordinary components and attributes alone", () => {
    expect(findExecutableMdx('<Callout tone="warn">Careful.</Callout>')).toEqual([]);
    expect(findExecutableMdx('<img src="/hero.png" alt="Hero" />')).toEqual([]);
  });
});

describe("parser agreement", () => {
  it("parses the GFM the renderer parses", () => {
    // The renderer compiles with remark-gfm. If this parser did not, a table or
    // footnote could fail here and compile there — and the old "unparseable
    // means nothing to execute" shortcut would have waved it through.
    expect(findExecutableMdx("| a | b |\n| - | - |\n| 1 | 2 |")).toEqual([]);
    expect(findExecutableMdx("~~struck~~ and https://example.com")).toEqual([]);
  });

  it("refuses what it cannot parse, rather than assuming it is safe", () => {
    expect(() => findExecutableMdx("<Unclosed")).toThrowError(UncheckableMdxError);
  });
});
