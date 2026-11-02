import { describe, expect, it } from "vitest";
import { renderable, safeProps } from "./guard.js";

describe("MdxContent's render-time guard", () => {
  it("refuses the elements that load or run code, in any case", () => {
    for (const tag of [
      "script",
      "SCRIPT",
      "iframe",
      "object",
      "embed",
      "frame",
      "frameset",
      "base",
    ]) {
      expect(renderable(tag), tag).toBe(false);
    }
    for (const tag of ["p", "a", "img", "table", "pre", "aside"])
      expect(renderable(tag), tag).toBe(true);
  });

  it("drops handlers and raw-HTML attributes, and keeps the rest", () => {
    expect(
      safeProps({
        href: "/about",
        class: "box",
        onclick: "steal()",
        onError: "steal()",
        innerHTML: "<img src=x onerror=steal()>",
        outerhtml: "x",
        dangerouslySetInnerHTML: "x",
        open: true,
        // Not a handler: no letter after "on".
        "on-the-fly": "kept",
      }),
    ).toEqual({ href: "/about", class: "box", open: true, "on-the-fly": "kept" });
  });
});
