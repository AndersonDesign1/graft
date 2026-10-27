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

  it("lists the first five offenders with their lines and snippets", () => {
    // The message is what an agent reads to fix the body, so its shape is the
    // contract: kind, line and source for each, capped at five.
    const body = ["{a}", "{b}", "{c}", "{d}", "{e}", "{f}", "{g}"].join("\n\n");
    expect(() => assertSafeMdx(body, { label: "pages/many" })).toThrowError(
      "Executable MDX is not accepted in pages/many — found " +
        "a `{…}` expression (line 1): a; a `{…}` expression (line 3): b; " +
        "a `{…}` expression (line 5): c; a `{…}` expression (line 7): d; " +
        "a `{…}` expression (line 9): e …and 2 more.",
    );
  });

  it("shortens a long snippet to 80 characters", () => {
    const long = `{${"x".repeat(100)}}`;
    expect(findExecutableMdx(long)[0]?.snippet).toBe(`${"x".repeat(77)}…`);
  });

  it("refuses a body it cannot parse with a structured error, not a bare one", () => {
    // MCP `write_content` and Studio saves call this. A bare Error there reads
    // as a transport fault to the client instead of "fix your MDX".
    let error: unknown;
    try {
      assertSafeMdx("<Unclosed", { label: "pages/broken" });
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      message: expect.stringContaining(
        "MDX could not be parsed in pages/broken, so it cannot be checked",
      ),
      details: { label: "pages/broken", reason: "MDX could not be parsed for safety checking" },
    });
  });
});

describe("non-expression execution", () => {
  it("refuses elements that load or run code", () => {
    // No `{}` anywhere, so the expression checks never see these — and MDX
    // renders an unknown lowercase tag straight through to HTML.
    // Every element on the list, so dropping one from it fails here.
    for (const source of [
      "<script>alert(1)</script>",
      "<SCRIPT>alert(1)</SCRIPT>",
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x.swf"></object>',
      '<embed src="x.swf" />',
      '<frame src="https://evil.example" />',
      "<frameset></frameset>",
      '<base href="https://evil.example/" />',
    ]) {
      expect(findExecutableMdx(source)[0]?.kind, source).toBe("scripting-element");
    }
  });

  it("accepts fragments and boolean attributes", () => {
    // A fragment has no element name and a bare attribute has no value. Both
    // are ordinary content, and the checks must read past them, not trip.
    expect(findExecutableMdx("<>\n\nInside a fragment.\n\n</>")).toEqual([]);
    expect(findExecutableMdx('<Details open summary="More">Hidden.</Details>')).toEqual([]);
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
