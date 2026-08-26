import { describe, expect, it } from "vitest";
import { MdxBody } from "./mdx";

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
