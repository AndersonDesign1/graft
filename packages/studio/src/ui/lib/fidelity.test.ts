/**
 * The fidelity check decides whether a document is safe to edit richly. It
 * replaced a regex that refused any document containing JSX — measured against
 * the real docs-site tree, that regex locked three of twenty documents out of
 * an editor they round-tripped through untouched.
 *
 * A false "lossless" rewrites someone's components on the next autosave, so
 * the comparison stays byte-exact everywhere it could matter, and forgives
 * only trailing whitespace.
 */
import { describe, expect, it } from "vitest";
import { compareRoundTrip, describeFidelity } from "./fidelity";

describe("compareRoundTrip", () => {
  it("accepts an identical round trip", () => {
    const body = "# Title\n\nSome **bold** text.\n";
    expect(compareRoundTrip(body, body)).toEqual({ lossless: true });
  });

  it("forgives trailing whitespace and a settled final newline", () => {
    const authored = "# Title\n\nBody text.\n";
    const emitted = "# Title   \n\nBody text.\n\n\n";
    expect(compareRoundTrip(authored, emitted).lossless).toBe(true);
  });

  it("normalises CRLF, so a Windows checkout is not permanently refused", () => {
    expect(compareRoundTrip("# Title\r\n\r\nBody.\r\n", "# Title\n\nBody.\n").lossless).toBe(true);
  });

  it("accepts a JSX block that survives verbatim", () => {
    // The case the old regex refused outright. An unbroken JSX block parses as
    // a commonmark HTML block and is written back untouched.
    const body = ['<Callout label="invariant">', "  Git is authoritative.", "</Callout>", ""].join(
      "\n",
    );
    expect(compareRoundTrip(body, body).lossless).toBe(true);
  });

  // ---- style is forgiven -------------------------------------------------
  // The line: the editor may normalise markdown style, never content.

  it("forgives a swapped bullet marker", () => {
    expect(compareRoundTrip("Intro.\n\n- one\n- two\n", "Intro.\n\n* one\n* two\n").lossless).toBe(
      true,
    );
  });

  it("forgives table delimiter width and cell padding", () => {
    const authored = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const emitted = "| a   | b     |\n| --- | ----- |\n| 1   | 2     |\n";
    expect(compareRoundTrip(authored, emitted).lossless).toBe(true);
  });

  it("keeps alignment colons — they are meaning, not width", () => {
    const authored = "| a | b |\n| :-- | --: |\n| 1 | 2 |\n";
    const emitted = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(compareRoundTrip(authored, emitted).lossless).toBe(false);
  });

  it("never normalises inside fenced code", () => {
    // A markdown example in a fence is content. Rewriting it would be damage.
    const authored = ["```md", "| a | b |", "| --- | --- |", "* item", "```"].join("\n");
    const emitted = ["```md", "| a | b |", "| - | - |", "- item", "```"].join("\n");
    expect(compareRoundTrip(authored, emitted).lossless).toBe(false);
  });

  // ---- content is not ----------------------------------------------------

  it("refuses changed cell text even when the padding also moved", () => {
    const authored = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const emitted = "| a   | b   |\n| --- | --- |\n| 1   | 9   |\n";
    const result = compareRoundTrip(authored, emitted);
    expect(result.lossless).toBe(false);
    expect(result.line).toBe(3);
  });

  it("quotes the operator's own line, not the canonical form", () => {
    // The notice has to name something they can find in their file.
    const authored = "Intro.\n\n|  a  |  b  |\n| --- | --- |\n|  1  |  2  |\n";
    const emitted = "Intro.\n\n| a | b |\n| --- | --- |\n| 1 | 9 |\n";
    const result = compareRoundTrip(authored, emitted);
    expect(result.lossless).toBe(false);
    expect(result.was).toBe("|  1  |  2  |");
  });

  it("refuses an escaped brace — identical markdown, broken MDX", () => {
    // Why this compares bytes rather than syntax trees: `\{` and `{` parse to
    // the same markdown text node and mean different things to MDX.
    const authored = "The answer is {count}.\n";
    const emitted = "The answer is \\{count}.\n";
    expect(compareRoundTrip(authored, emitted).lossless).toBe(false);
  });

  it("reports a dropped line", () => {
    const result = compareRoundTrip("one\n\ntwo\n", "one\n");
    expect(result.lossless).toBe(false);
    expect(result.line).toBe(2);
  });
});

describe("describeFidelity", () => {
  it("says nothing when the round trip is clean", () => {
    expect(describeFidelity({ lossless: true })).toBe("");
  });

  it("names the line and both sides of a rewrite", () => {
    const message = describeFidelity({ lossless: false, line: 3, was: "- one", now: "* one" });
    expect(message).toContain("line 3");
    expect(message).toContain("- one");
    expect(message).toContain("* one");
  });

  it("truncates a long line rather than spilling it into the notice", () => {
    const long = "x".repeat(200);
    const message = describeFidelity({ lossless: false, line: 1, was: long, now: "y" });
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(200);
  });

  it("describes a dropped line without pretending there is a replacement", () => {
    const message = describeFidelity({ lossless: false, line: 4, was: "gone", now: "" });
    expect(message).toContain("drop");
    expect(message).toContain("line 4");
  });
});
