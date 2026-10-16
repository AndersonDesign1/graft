import { describe, expect, it } from "vitest";
import { MdxBody, prepareMdx } from "./mdx";

describe("MdxBody trust", () => {
  it("renders ordinary authored content", async () => {
    const el = await MdxBody({ source: "# Title\n\nProse." });
    expect(el).not.toBeNull();
  });

  it("refuses executable MDX by default", async () => {
    // `run()` evaluates the compiled body with `new Function` in this process,
    // so an expression is arbitrary server-side JavaScript. Checked at render
    // as well as at write, because content can also arrive through a direct
    // database write with the runtime credential.
    await expect(MdxBody({ source: "{globalThis.process.env.SECRET}" })).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });

    await expect(MdxBody({ source: 'import fs from "node:fs";\n\nHi' })).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
  });

  it("allows full MDX when the caller opts in", async () => {
    const el = await MdxBody({ source: "{1 + 1}", trust: "full" });
    expect(el).not.toBeNull();
  });

  it("renders nothing for an empty body without checking it", async () => {
    expect(await MdxBody({ source: "   " })).toBeNull();
  });
});

describe("prepareMdx", () => {
  // What MdxContent does with the string, minus React: run the function body
  // with the production JSX runtime and call the component it returns.
  async function evaluate(code: string, components: Record<string, unknown> = {}) {
    const runtime = await import("react/jsx-runtime");
    const content: unknown = new Function(code)({ ...runtime }).default({ components });
    return JSON.stringify(content);
  }

  it("compiles a body to code the production JSX runtime runs", async () => {
    const code = await prepareMdx("Made with **Graft**.");
    expect(code).not.toContain("jsxDEV");
    expect(await evaluate(code)).toContain(
      '"type":"strong","key":null,"props":{"children":"Graft"}',
    );
  });

  it("applies the trust rule on the server", async () => {
    await expect(prepareMdx("{globalThis.process.env.SECRET}")).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
    expect(await evaluate(await prepareMdx("{1 + 1}", { trust: "full" }))).toContain(
      '"children":2',
    );
  });

  it("refuses an import the browser could not resolve, even with full trust", async () => {
    await expect(
      prepareMdx('import Chart from "./chart.js";\n\n<Chart />', { trust: "full" }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED", details: { reason: "mdx-import" } });
  });

  it("gives an empty string for an empty body", async () => {
    expect(await prepareMdx("  \n ")).toBe("");
  });
});
