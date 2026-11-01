/**
 * prepareMdx and MdxContent together, the way an app uses them: compile on
 * the server, render with Vue's own server renderer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { MdxContent, type MdxComponents } from "./mdx";
import { prepareMdx } from "./server";

const Callout = defineComponent({
  props: { tone: { type: String, default: "note" } },
  setup(props, { slots }) {
    return () => h("aside", { class: `callout-${props.tone}` }, slots.default?.());
  },
});

async function render(source: string, components: MdxComponents = { Callout }, trust?: "full") {
  const code = await prepareMdx(source, { trust });
  return renderToString(createSSRApp({ render: () => h(MdxContent, { code, components }) }));
}

afterEach(() => vi.restoreAllMocks());

describe("prepareMdx + MdxContent", () => {
  it("renders Markdown, GFM tables and components with their content as a slot, without a Vue warning", async () => {
    const warn = vi.spyOn(console, "warn");
    const html = await render(
      '# Hello\n\nSome **bold**.\n\n<Callout tone="warn">Mind *this*.</Callout>\n\n| a | b |\n| - | - |\n| 1 | 2 |',
    );
    expect(html).toBe(
      "<!--[--><h1>Hello</h1>\n<p>Some <strong>bold</strong>.</p>\n" +
        '<aside class="callout-warn">Mind <em>this</em>.</aside>\n' +
        "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><!--]-->",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("renders the React-style attribute and style names authors write in JSX, which Vue maps", async () => {
    const html = await render('<label htmlFor="x" className="box">a</label>', {}, "full");
    expect(html).toBe('<label for="x" class="box">a</label>');
    const styled = await render('<p style={{ fontSize: "2px" }}>b</p>', {}, "full");
    expect(styled).toBe('<p style="font-size:2px;">b</p>');
  });

  it("drops a javascript: link under restricted trust, which Vue would otherwise render as it is", async () => {
    const html = await render("[Read more](javascript:alert(document.cookie)) and [ok](/docs)");
    expect(html).toBe('<p><a>Read more</a> and <a href="/docs">ok</a></p>');
    expect(await render("[x](javascript:void(0))", {}, "full")).toContain(
      'href="javascript:void(0)"',
    );
  });

  it("refuses executable MDX under restricted trust before compiling", async () => {
    await expect(prepareMdx("{process.env.SECRET}")).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
    await expect(prepareMdx("<script>alert(1)</script>")).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
  });

  it("refuses an innerHTML attribute, which Vue would render as raw HTML", async () => {
    await expect(
      prepareMdx('<div innerHTML="<img src=x onerror=alert(1)>">a</div>'),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
  });

  it("refuses a body that imports modules even under full trust, because the browser has no bundler", async () => {
    await expect(prepareMdx('import X from "x";\n\nHi', { trust: "full" })).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      details: { reason: "mdx-import" },
    });
  });

  it("renders nothing for an empty body", async () => {
    expect(await prepareMdx("  \n ")).toBe("");
    expect(await render("")).toBe("<!---->");
  });
});
