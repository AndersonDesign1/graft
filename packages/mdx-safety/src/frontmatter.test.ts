import { GraftError } from "@usegraft/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { readFrontmatter, writeFrontmatter } from "./frontmatter";

const ran = "__graftFrontmatterRan";
const flags: Record<string, unknown> = globalThis;

afterEach(() => {
  delete flags[ran];
});

function refusal(raw: string): GraftError {
  try {
    readFrontmatter(raw);
  } catch (error) {
    if (error instanceof GraftError) return error;
    throw error;
  }
  throw new Error("expected readFrontmatter to refuse");
}

describe("readFrontmatter", () => {
  it("reads YAML frontmatter and the body", () => {
    expect(readFrontmatter("---\ntitle: Home\norder: 2\n---\nHello.\n")).toEqual({
      data: { title: "Home", order: 2 },
      content: "Hello.\n",
    });
  });

  it("reads ---yaml and ---json", () => {
    expect(readFrontmatter("---yaml\ntitle: A\n---\n").data).toEqual({ title: "A" });
    expect(readFrontmatter('---json\n{"title": "B"}\n---\n').data).toEqual({ title: "B" });
  });

  it("gives empty data for a file with no frontmatter", () => {
    expect(readFrontmatter("Just a body.\n")).toEqual({ data: {}, content: "Just a body.\n" });
  });

  it.each(["js", "javascript", "JS", "JavaScript", "coffee", "cson", "toml"])(
    "refuses ---%s without running it",
    (language) => {
      const error = refusal(
        `---${language}\n(globalThis.${ran} = true, { title: "x" })\n---\nBody\n`,
      );
      expect(error.code).toBe("INPUT_VALIDATION_FAILED");
      expect(error.details).toEqual({
        reason: "frontmatter-language",
        language: language.toLowerCase(),
      });
      expect(flags[ran]).toBeUndefined();
    },
  );

  it("refuses with CRLF line endings too", () => {
    expect(refusal(`---js\r\n(globalThis.${ran} = true, {})\r\n---\r\n`).code).toBe(
      "INPUT_VALIDATION_FAILED",
    );
    expect(flags[ran]).toBeUndefined();
  });
});

describe("writeFrontmatter", () => {
  it("writes YAML that reads back the same", () => {
    const raw = writeFrontmatter("Body.\n", { title: "T", tags: ["a"] });
    expect(raw.startsWith("---\n")).toBe(true);
    expect(readFrontmatter(raw)).toEqual({ data: { title: "T", tags: ["a"] }, content: "Body.\n" });
  });

  it("keeps a long string on one line with lineWidth -1", () => {
    const long = "word ".repeat(30).trim();
    const raw = writeFrontmatter("", { description: long }, { lineWidth: -1 });
    expect(raw).toContain(`description: ${long}\n`);
  });
});
