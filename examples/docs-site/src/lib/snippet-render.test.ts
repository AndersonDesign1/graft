/**
 * The other half of the search contract: what markSnippet escapes has to
 * survive fumadocs' own Markdown renderer as the text the author wrote.
 *
 * This is worth a real render rather than an assertion about CommonMark,
 * because the escaping is only correct if the renderer decodes it. It already
 * caught one: "\1." is not a valid escape — a backslash is only honoured
 * before ASCII punctuation, so an ordered marker has to be escaped on its
 * delimiter ("1\.") or the reader sees the backslash.
 *
 * Mirrors the renderer config in fumadocs-ui's search dialog: raw HTML enabled
 * (which is why <mark> works and why everything else must be escaped).
 */
import { createMarkdownRenderer } from "fumadocs-core/content/md";
import rehypeRaw from "rehype-raw";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { markSnippet } from "./search-results";

const { MarkdownServer } = createMarkdownRenderer({
  remarkRehypeOptions: { allowDangerousHtml: true },
  rehypePlugins: [rehypeRaw],
});

/** Render a snippet the way the search dialog does. MarkdownServer is async. */
async function render(snippet: string): Promise<string> {
  return renderToStaticMarkup(await MarkdownServer({ children: markSnippet(snippet) }));
}

/** Render a snippet the way the search dialog does, then read its text back. */
async function visibleText(snippet: string): Promise<string> {
  return (await render(snippet))
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The marks a reader should end up seeing, as rendered <mark> elements. */
async function marks(snippet: string): Promise<string[]> {
  const html = await render(snippet);
  return [...html.matchAll(/<mark>(.*?)<\/mark>/g)].map((match) => match[1]);
}

describe("a rendered snippet shows the bytes the author wrote", () => {
  const cases: Array<[name: string, snippet: string, visible: string]> = [
    ["a heading fragment", "## Human-gated <b>approvals</b>", "## Human-gated approvals"],
    ["a code fence", "```sh\ngraft <b>approve</b>\n```", "```sh graft approve ```"],
    ["inline code", "run `graft <b>serve</b>` now", "run `graft serve` now"],
    ["bold markers", "the **<b>approval</b>** gate", "the **approval** gate"],
    ["an underscored code", "<b>APPROVAL</b>_INVALID", "APPROVAL_INVALID"],
    ["a JSX component", "use <Callout> for <b>notes</b>", "use <Callout> for notes"],
    ["an ampersand", "audit &amp; <b>approvals</b>", "audit &amp; approvals"],
    ["a bullet marker", "- an <b>approval</b> row", "- an approval row"],
    ["an ordered marker", "1. file the <b>approval</b>", "1. file the approval"],
    ["a paren marker", "12) then <b>approve</b>", "12) then approve"],
    [
      "a link",
      "see [the docs](/docs/x) on <b>approvals</b>",
      "see [the docs](/docs/x) on approvals",
    ],
    ["a table row", "| `graft <b>approve</b>` | Decide one |", "| `graft approve` | Decide one |"],
  ];

  for (const [name, snippet, expected] of cases) {
    it(`${name} survives the renderer`, async () => {
      expect(await visibleText(snippet)).toBe(expected);
    });
  }

  it("never leaks a stray backslash into what the reader sees", async () => {
    for (const [, snippet] of cases) {
      expect(await visibleText(snippet)).not.toContain("\\");
    }
  });

  it("still highlights the matched terms", async () => {
    expect(await marks("## Human-gated <b>approvals</b>")).toEqual(["approvals"]);
    expect(await marks("`graft <b>approve</b>` and <b>approvals</b>")).toEqual([
      "approve",
      "approvals",
    ]);
  });

  it("renders no heading, list, or code element — a result row is one line", async () => {
    const html = await render("## Gate\n\n- one\n\n```sh\nrun\n```");

    expect(html).not.toMatch(/<h[1-6]|<ul|<ol|<li|<pre|<code/);
  });
});
