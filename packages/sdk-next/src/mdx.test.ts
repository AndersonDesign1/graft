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

  it("takes a body that only mentions an import, in code or prose", async () => {
    const body =
      'Load it lazily with `await import("./x.js")`.\n\n```js\nconst m = await import("./x.js");\n```';
    expect(await evaluate(await prepareMdx(body))).toContain("await import");
  });

  it("refuses import() and import.meta under full trust, which the browser can't run", async () => {
    for (const body of ['{import("https://example.com/x.js")}', "{import.meta.url}"]) {
      await expect(prepareMdx(body, { trust: "full" })).rejects.toMatchObject({
        details: { reason: "mdx-import" },
      });
    }
  });
});

describe("URLs in restricted MDX", () => {
  // The element tree prepareMdx's code builds, as JSON: what React would render.
  async function tree(source: string, trust?: "full"): Promise<string> {
    const runtime = await import("react/jsx-runtime");
    const code = await prepareMdx(source, trust ? { trust } : {});
    const Card = () => null;
    return JSON.stringify(new Function(code)({ ...runtime }).default({ components: { Card } }));
  }

  it("drops a link or source that would run script", async () => {
    const out = await tree(
      [
        "[Read more](javascript:alert(document.cookie))",
        '<a href="javascript:alert(1)">tag</a>',
        '<a href="java\tscript:alert(1)">tab</a>',
        '<a href="&#106;avascript:alert(1)">entity</a>',
        '<img src="data:text/html,<script>alert(1)</script>" alt="x" />',
        '<Card href="JavaScript:alert(1)" />',
      ].join("\n\n"),
    );
    expect(out.toLowerCase()).not.toContain("script:");
    expect(out).not.toContain("data:");
    // The elements themselves stay, without the attribute.
    expect(out).toContain('"children":"Read more"');
    expect(out).toContain('"alt":"x"');
  });

  it("keeps ordinary links", async () => {
    const out = await tree(
      '[Docs](https://graft.page/docs) [Home](/home) [Mail](mailto:hi@graft.page) <Card href="#top" />',
    );
    for (const href of ["https://graft.page/docs", "/home", "mailto:hi@graft.page", "#top"]) {
      expect(out).toContain(`"href":"${href}"`);
    }
  });

  it("leaves full-trust bodies as written", async () => {
    expect(await tree("[x](javascript:void(0))", "full")).toContain("javascript:void(0)");
  });
});
