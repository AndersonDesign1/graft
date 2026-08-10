import { describe, expect, it } from "vitest";
import { elementSummary, parseInline, parseMdxElement, type MdxElement } from "./mdx-element";

/** The real block from examples/docs-site/content/docs/what-is-graft.mdx. */
const DOC_CARDS = `<DocCards>
  <DocCard title="Getting started" href="/docs/getting-started">
    Init a project, compile MDX, read it typed.
  </DocCard>
  <DocCard title="Reading content" href="/docs/reading-content">
    Next, Astro, and SvelteKit SDK surfaces.
  </DocCard>
</DocCards>`;

describe("parseMdxElement", () => {
  it("reads the nested block that motivated this", () => {
    const el = parseMdxElement(DOC_CARDS);
    expect(el?.name).toBe("DocCards");
    expect(el?.children).toHaveLength(2);

    const first = el?.children[0] as MdxElement;
    expect(first.name).toBe("DocCard");
    expect(first.attributes).toEqual([
      { name: "title", value: "Getting started", expression: false },
      { name: "href", value: "/docs/getting-started", expression: false },
    ]);
    expect(elementSummary(first)).toBe("Init a project, compile MDX, read it typed.");
  });

  it("handles self-closing elements", () => {
    const el = parseMdxElement('<Callout type="warn" />');
    expect(el?.selfClosing).toBe(true);
    expect(el?.attributes[0]).toEqual({ name: "type", value: "warn", expression: false });
  });

  it("keeps expression attributes as their source text", () => {
    const el = parseMdxElement("<Chart data={rows.filter((r) => r.n > 1)} live />");
    expect(el?.attributes).toEqual([
      { name: "data", value: "rows.filter((r) => r.n > 1)", expression: true },
      { name: "live", value: "true", expression: true },
    ]);
  });

  it("does not end an expression on a brace inside a string", () => {
    const el = parseMdxElement(`<X label={"a}b"} />`);
    expect(el?.attributes[0]?.value).toBe(`"a}b"`);
  });

  it("accepts single-quoted attribute values", () => {
    expect(parseMdxElement(`<X title='hi' />`)?.attributes[0]?.value).toBe("hi");
  });

  it("accepts dotted component names", () => {
    expect(parseMdxElement("<Tabs.Panel>body</Tabs.Panel>")?.name).toBe("Tabs.Panel");
  });

  // Everything below must refuse, because the block falls back to showing its
  // source and that is always safe — a card that hid content would not be.
  it.each([
    ["a lowercase HTML tag", "<div>hi</div>"],
    ["plain text", "just words"],
    ["an unclosed element", "<DocCards><DocCard /></DocCards"],
    ["a mismatched closing tag", "<A>hi</B>"],
    ["two root elements", "<A />\n<B />"],
    ["trailing text after the element", "<A />tail"],
    ["spread props", "<A {...props} />"],
    ["an expression child", "<A>{count}</A>"],
    ["an unterminated attribute string", '<A title="x />'],
    ["an unterminated expression", "<A data={oops />"],
  ])("refuses %s", (_label, source) => {
    expect(parseMdxElement(source)).toBeNull();
  });

  it("refuses an element whose child element is malformed", () => {
    expect(parseMdxElement("<A><B {...x} /></A>")).toBeNull();
  });
});

describe("parseInline", () => {
  it("renders the forms component bodies actually use", () => {
    expect(parseInline("Every function is a **stateless** handler (`Request`).")).toEqual([
      { kind: "text", value: "Every function is a " },
      { kind: "strong", value: "stateless" },
      { kind: "text", value: " handler (" },
      { kind: "code", value: "Request" },
      { kind: "text", value: ")." },
    ]);
  });

  it("keeps a link's text and drops only its target", () => {
    expect(parseInline("see [the docs](/docs/x) now")).toEqual([
      { kind: "text", value: "see " },
      { kind: "text", value: "the docs" },
      { kind: "text", value: " now" },
    ]);
  });

  it("leaves unmatched syntax as plain text", () => {
    expect(parseInline("a ** dangling")).toEqual([{ kind: "text", value: "a ** dangling" }]);
  });

  it("emits nothing for empty input", () => {
    expect(parseInline("")).toEqual([]);
  });

  // The reason `_emphasis_` is not supported at all: a lazy underscore pair
  // matches across two snake_case identifiers and eats the underscores. In a
  // CMS for technical content that is a correctness bug, not a missing feature.
  it.each([
    "call graft_add then graft_compile",
    "content_index and data_records",
    "a _lone underscore",
  ])("leaves underscores alone in %s", (source) => {
    expect(parseInline(source)).toEqual([{ kind: "text", value: source }]);
  });
});
