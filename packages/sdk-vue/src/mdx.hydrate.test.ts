// @vitest-environment jsdom
/**
 * The reason MdxContent exists: a page rendered on the server must hydrate in
 * the browser to the same nodes, with the compiled string as its only input.
 */
import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { MdxContent } from "./mdx";
import { prepareMdx } from "./server";

const Callout = defineComponent({
  setup(_, { slots }) {
    return () => h("aside", slots.default?.());
  },
});

describe("MdxContent hydration", () => {
  it("hydrates server-rendered MDX with no mismatch", async () => {
    const code = await prepareMdx("# Title\n\n<Callout>Inside *it*.</Callout>\n\n- one\n- two");
    const app = () =>
      createSSRApp({ render: () => h(MdxContent, { code, components: { Callout } }) });

    const root = document.createElement("div");
    root.innerHTML = await renderToString(app());
    const serverHtml = root.innerHTML;
    const serverAside = root.querySelector("aside");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");

    app().mount(root);

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(root.innerHTML).toBe(serverHtml);
    // Hydrated in place: the node the server rendered is the one Vue kept.
    expect(root.querySelector("aside")).toBe(serverAside);
    expect(root.querySelector("aside em")?.textContent).toBe("it");
  });
});
