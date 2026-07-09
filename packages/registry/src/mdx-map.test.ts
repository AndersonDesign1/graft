import { describe, expect, it } from "vitest";
import { componentExportName, mdxComponentsSource } from "./mdx-map";

describe("componentExportName", () => {
  it("PascalCases the basename", () => {
    expect(componentExportName("Callout.tsx")).toBe("Callout");
    expect(componentExportName("callout")).toBe("Callout");
    expect(componentExportName("Faq.tsx")).toBe("Faq");
  });
});

describe("mdxComponentsSource", () => {
  it("emits an empty typed map when there are no components", () => {
    const src = mdxComponentsSource([]);
    expect(src).toContain('import type { MdxComponents } from "@graft/sdk-next"');
    expect(src).toContain("export const mdxComponents: MdxComponents = {};");
    expect(src).not.toContain("import {");
  });

  it("imports and registers each component (sorted)", () => {
    const src = mdxComponentsSource(["Faq", "Callout"]);
    expect(src).toContain('import { Callout } from "./Callout";');
    expect(src).toContain('import { Faq } from "./Faq";');
    expect(src).toContain("export const mdxComponents: MdxComponents = {");
    expect(src).toContain("  Callout,");
    expect(src).toContain("  Faq,");
    // Callout before Faq (sorted by export name).
    expect(src.indexOf("Callout")).toBeLessThan(src.indexOf("Faq"));
  });
});
