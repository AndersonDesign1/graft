import { prepareMdx } from "@usegraft/mdx-safety/prepare";
import type { MdxTree } from "@usegraft/mdx-safety/tree";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MdxContent } from "./mdx";

const render = (tree: MdxTree, components = {}) =>
  renderToStaticMarkup(<MdxContent tree={tree} components={components} />);

function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  return <aside className={`callout callout-${type}`}>{children}</aside>;
}

describe("MdxContent for React", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a prepared body: Markdown, a GFM table and a component from the map", () => {
    const tree = prepareMdx(
      'Some **bold**.\n\n| a |\n| - |\n| 1 |\n\n<Callout type="tip">\n\nInside *it*.\n\n</Callout>',
    );
    // No whitespace between table parts: the browser would drop it, and the
    // page would not hydrate.
    expect(render(tree, { Callout })).toBe(
      "<p>Some <strong>bold</strong>.</p>\n" +
        "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>\n" +
        '<aside class="callout callout-tip"><p>Inside <em>it</em>.</p></aside>',
    );
  });

  it("renders a component it has no entry for as its content alone", () => {
    expect(render(prepareMdx('<Callout type="tip">\n\nKept.\n\n</Callout>'))).toBe("<p>Kept.</p>");
  });

  it("gives React its own names for HTML attributes, without a warning", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const tree = prepareMdx(
      '<div className="box" style="color: red; --gap: 2px">\n\n<label htmlFor="x">L</label>\n\n</div>\n\nSee <time dateTime="2026-01-01">then</time>.',
    );
    expect(render(tree)).toBe(
      '<div class="box" style="color:red;--gap:2px"><p><label for="x">L</label></p></div>\n' +
        '<p>See <time dateTime="2026-01-01">then</time>.</p>',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops scripts, handlers and raw HTML from a tree built by hand", () => {
    const tree: MdxTree = [
      { type: "element", tag: "SCRIPT", props: {}, children: [{ type: "text", value: "x()" }] },
      {
        type: "element",
        tag: "p",
        props: { class: "kept", onclick: "steal()", dangerouslySetInnerHTML: "<b>raw</b>" },
        children: [{ type: "text", value: "Safe text." }],
      },
      { type: "component", name: "Callout", props: { onError: "steal()" }, children: [] },
    ];
    expect(render(tree, { Callout })).toBe(
      '<p class="kept">Safe text.</p><aside class="callout callout-undefined"></aside>',
    );
  });

  it("renders nothing for an empty tree", () => {
    expect(render([])).toBe("");
  });
});
