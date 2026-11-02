import { describe, expect, it } from "vitest";
import { prepareMdx, type MdxNode, type MdxTree } from "./server";

/** The tree without the whitespace text between blocks, to keep expectations short. */
function blocks(tree: MdxTree): MdxNode[] {
  return tree.filter((node) => node.type !== "text" || node.value.trim() !== "");
}

const text = (value: string): MdxNode => ({ type: "text", value });

describe("prepareMdx", () => {
  it("turns Markdown into elements and text", () => {
    expect(blocks(prepareMdx("# Hello\n\nSome **bold** words."))).toEqual([
      { type: "element", tag: "h1", props: {}, children: [text("Hello")] },
      {
        type: "element",
        tag: "p",
        props: {},
        children: [
          text("Some "),
          { type: "element", tag: "strong", props: {}, children: [text("bold")] },
          text(" words."),
        ],
      },
    ]);
  });

  it("gives an empty tree for an empty body", () => {
    expect(prepareMdx("  \n ")).toEqual([]);
  });

  it("keeps a component's name, literal props and content", () => {
    const [callout] = blocks(
      prepareMdx('<Callout type="note" open>\n\nRead *this*.\n\n</Callout>'),
    );
    expect(callout).toEqual({
      type: "component",
      name: "Callout",
      props: { type: "note", open: true },
      children: [
        {
          type: "element",
          tag: "p",
          props: {},
          children: [
            text("Read "),
            { type: "element", tag: "em", props: {}, children: [text("this")] },
            text("."),
          ],
        },
      ],
    });
  });

  it("writes HTML written as JSX with HTML attribute names", () => {
    const [div] = blocks(prepareMdx('<div className="box" htmlFor="x">\n\nhi\n\n</div>'));
    expect(div).toMatchObject({ type: "element", tag: "div", props: { class: "box", for: "x" } });
  });

  it("gives an HTML void element written as JSX no content, as HTML would", () => {
    const [paragraph] = blocks(prepareMdx("a <br>lost</br> b"));
    expect(paragraph).toMatchObject({
      type: "element",
      tag: "p",
      children: [text("a "), { type: "element", tag: "br", props: {}, children: [] }, text(" b")],
    });
  });

  it("puts a fragment's children in its place", () => {
    const [paragraph] = blocks(prepareMdx("<>\n\nInside\n\n</>"));
    expect(paragraph).toMatchObject({ type: "element", tag: "p", children: [text("Inside")] });
  });

  it("keeps code exactly, newlines included", () => {
    const [pre] = blocks(prepareMdx("```js\nconst a = 1;\nconst b = 2;\n```"));
    expect(pre).toEqual({
      type: "element",
      tag: "pre",
      props: {},
      children: [
        {
          type: "element",
          tag: "code",
          props: { class: "language-js" },
          children: [text("const a = 1;\nconst b = 2;\n")],
        },
      ],
    });
  });

  it("drops a script URL under restricted trust, and keeps it under full", () => {
    const source = "[ok](https://example.com) [bad](javascript:alert(1))";
    const links = (tree: MdxTree) => {
      const [paragraph] = blocks(tree);
      return paragraph?.type === "element"
        ? paragraph.children.filter((node) => node.type === "element").map((node) => node.props)
        : [];
    };
    expect(links(prepareMdx(source))).toEqual([{ href: "https://example.com" }, {}]);
    expect(links(prepareMdx(source, { trust: "full" }))).toEqual([
      { href: "https://example.com" },
      { href: "javascript:alert(1)" },
    ]);
  });

  it("refuses anything executable under every trust level, since nothing is evaluated", () => {
    for (const source of [
      "{1 + 1}",
      'import X from "x"',
      "export const a = 1",
      "<Card {...props} />",
      "<Card title={name} />",
      "<script>alert(1)</script>",
      '<a onClick="steal()">a</a>',
    ]) {
      for (const trust of ["restricted", "full"] as const) {
        expect(() => prepareMdx(source, { trust, label: "pages/home" }), source).toThrowError(
          expect.objectContaining({
            code: "INPUT_VALIDATION_FAILED",
            message: expect.stringContaining("pages/home"),
            fix: expect.stringMatching(/never runs the body/),
          }),
        );
      }
    }
  });

  it("is JSON all the way down, so it survives SvelteKit's data serialization", () => {
    const tree = prepareMdx('# T\n\n<Callout type="tip">\n\n- a\n- b\n\n</Callout>');
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});
