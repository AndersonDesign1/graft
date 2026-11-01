/**
 * The render-time plugins, run the way an MDX compile runs them: remark over a
 * parsed MDX tree, rehype over a hast tree. sdk-next and sdk-vue drive them
 * through a real compile in their own tests.
 */
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { isSafeUrl, rehypeSafeUrls, remarkRefuseModules } from "./render";

describe("isSafeUrl", () => {
  it("keeps relative URLs and the schemes that only navigate", () => {
    for (const url of ["/docs", "#top", "page?x=1", "https://a.test", "mailto:a@b.c", "tel:+1"]) {
      expect(isSafeUrl(url), url).toBe(true);
    }
  });

  it("refuses script schemes, including ones hidden by case, whitespace or control characters", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:x",
      "java\tscript:x",
      " data:text/html,x",
      "vbscript:x",
    ]) {
      expect(isSafeUrl(url), JSON.stringify(url)).toBe(false);
    }
  });
});

describe("rehypeSafeUrls", () => {
  /** The hast and MDX JSX node fields the plugin reads. */
  interface TreeNode {
    type: string;
    tagName?: string;
    name?: string;
    properties?: Record<string, unknown>;
    attributes?: { type: string; name?: string; value?: unknown }[];
    children?: TreeNode[];
  }

  const run = (tree: TreeNode): TreeNode => {
    rehypeSafeUrls()(tree);
    return tree;
  };

  it("drops unsafe URL properties on elements and keeps safe ones and everything else", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "a",
          properties: { href: "javascript:x", title: "t" },
          children: [],
        },
        { type: "element", tagName: "a", properties: { href: "https://ok.test" }, children: [] },
        {
          type: "element",
          tagName: "img",
          properties: { srcSet: ["/a.png 1x,", "javascript:x 2x"] },
          children: [],
        },
      ],
    });
    expect(tree).toEqual({
      type: "root",
      children: [
        { type: "element", tagName: "a", properties: { title: "t" }, children: [] },
        { type: "element", tagName: "a", properties: { href: "https://ok.test" }, children: [] },
        { type: "element", tagName: "img", properties: {}, children: [] },
      ],
    });
  });

  it("drops unsafe URL attributes on JSX components, nested anywhere", () => {
    const tree = run({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "mdxJsxTextElement",
              name: "Card",
              attributes: [
                { type: "mdxJsxAttribute", name: "href", value: "javascript:x" },
                { type: "mdxJsxAttribute", name: "xlink:href", value: "javascript:x" },
                { type: "mdxJsxAttribute", name: "xlink:href", value: "/fine" },
                { type: "mdxJsxAttribute", name: "label", value: "javascript:x is only text here" },
              ],
              children: [],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(tree)).toBe(
      JSON.stringify({
        type: "root",
        children: [
          {
            type: "element",
            tagName: "p",
            properties: {},
            children: [
              {
                type: "mdxJsxTextElement",
                name: "Card",
                attributes: [
                  { type: "mdxJsxAttribute", name: "xlink:href", value: "/fine" },
                  {
                    type: "mdxJsxAttribute",
                    name: "label",
                    value: "javascript:x is only text here",
                  },
                ],
                children: [],
              },
            ],
          },
        ],
      }),
    );
  });
});

describe("remarkRefuseModules", () => {
  const check = (source: string): void => {
    const processor = unified().use(remarkParse).use(remarkMdx).use(remarkRefuseModules);
    processor.runSync(processor.parse(source));
  };

  it("refuses a body that imports or re-exports a module", () => {
    for (const source of ['import X from "x";\n\nHi', 'export { y } from "y";\n\nHi']) {
      expect(() => check(source), source).toThrow(
        expect.objectContaining({
          code: "INPUT_VALIDATION_FAILED",
          details: { reason: "mdx-import" },
        }),
      );
    }
  });

  it("lets prose that only mentions an import through", () => {
    expect(() =>
      check('Write `import X from "x"` at the top.\n\n```js\nimport y from "y";\n```'),
    ).not.toThrow();
    expect(() => check("export const local = 1;\n\nHi")).not.toThrow();
  });
});
