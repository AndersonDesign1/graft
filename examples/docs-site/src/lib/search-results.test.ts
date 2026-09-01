import { describe, expect, it } from "vitest";
import {
  extractHeadings,
  headingForSnippet,
  markSnippet,
  toSearchResults,
  type SearchSourceHit,
} from "./search-results";

describe("extractHeadings", () => {
  it("slugs headings in document order, the way rehype-slug does", () => {
    const headings = extractHeadings(
      ["# Errors", "", "## Codes", "", "### APPROVAL_INVALID", "", "## Codes"].join("\n"),
    );

    expect(headings.map(({ id }) => id)).toEqual([
      "errors",
      "codes",
      "approval_invalid",
      // github-slugger disambiguates a repeat, and so will the rendered page.
      "codes-1",
    ]);
    expect(headings.map(({ depth }) => depth)).toEqual([1, 2, 3, 2]);
  });

  it("ignores headings inside fenced code, which are comments and not sections", () => {
    const body = [
      "## Install",
      "",
      "```bash",
      "## not a heading",
      "graft init",
      "```",
      "",
      "## Serve",
    ].join("\n");

    expect(extractHeadings(body).map(({ text }) => text)).toEqual(["Install", "Serve"]);
  });

  it("closes a fence only on its own delimiter, so a nested fence does not reopen", () => {
    const body = ["~~~md", "```", "## inside", "```", "~~~", "", "## Real"].join("\n");

    expect(extractHeadings(body).map(({ text }) => text)).toEqual(["Real"]);
  });

  it("slugs the rendered text, not the markup", () => {
    const headings = extractHeadings(
      ["## The `graft serve` route", "## A [linked](/docs/x) heading", "## **Bold** start"].join(
        "\n",
      ),
    );

    expect(headings.map(({ text }) => text)).toEqual([
      "The graft serve route",
      "A linked heading",
      "Bold start",
    ]);
    expect(headings.map(({ id }) => id)).toEqual([
      "the-graft-serve-route",
      "a-linked-heading",
      "bold-start",
    ]);
  });

  it("leaves snake_case alone — graft_add is a word, not emphasis", () => {
    expect(extractHeadings("## Call graft_add then graft_compile")[0]).toMatchObject({
      text: "Call graft_add then graft_compile",
      id: "call-graft_add-then-graft_compile",
    });
  });

  it("reads CRLF files, which several of these docs are", () => {
    // Found by anchor-parity.test.ts: splitting on \n leaves the \r in place,
    // where it defeats the end-anchored match and the file reports no headings
    // at all. Pinned here so it stays caught if the corpus ever goes all-LF.
    const headings = extractHeadings("## Prerequisites\r\n\r\ntext\r\n\r\n## Quick start\r\n");

    expect(headings.map(({ id }) => id)).toEqual(["prerequisites", "quick-start"]);
  });

  it("closes a CRLF fence, so the lines after it are read again", () => {
    const body = "```bash\r\n## comment\r\n```\r\n\r\n## Real\r\n";

    expect(extractHeadings(body).map(({ text }) => text)).toEqual(["Real"]);
  });

  it("records the offset of each heading line", () => {
    const body = "## One\n\ntext\n\n## Two";
    const [first, second] = extractHeadings(body);

    expect(body.slice(first.offset, first.offset + 6)).toBe("## One");
    expect(body.slice(second.offset)).toBe("## Two");
  });
});

describe("markSnippet", () => {
  it("translates ts_headline's <b> into the <mark> fumadocs renders", () => {
    expect(markSnippet("the <b>approval</b> gate")).toBe("the <mark>approval</mark> gate");
  });

  it("escapes authored markup so a snippet renders as the bytes the author wrote", () => {
    expect(markSnippet("use <Callout> for <b>notes</b>")).toBe(
      "use &lt;Callout&gt; for <mark>notes</mark>",
    );
  });

  it("escapes inline markdown punctuation rather than letting it format the result", () => {
    expect(markSnippet("run `graft serve` with **care**")).toBe(
      "run \\`graft serve\\` with \\*\\*care\\*\\*",
    );
  });

  it("escapes inside the mark too", () => {
    expect(markSnippet("<b>APPROVAL_INVALID</b>")).toBe("<mark>APPROVAL\\_INVALID</mark>");
  });

  it("passes an unmatched snippet through, escaped", () => {
    expect(markSnippet("plain & simple")).toBe("plain &amp; simple");
  });

  it("collapses a multi-line fragment to one line", () => {
    // Measured against the real docs: ts_headline returns up to 400 characters
    // over eleven lines. A `##` at the start of one of them renders as an <h2>
    // inside the search result row.
    expect(markSnippet("gate.\n\n## Human-gated <b>approvals</b>\n\n`destructive: true`")).toBe(
      "gate. \\#\\# Human-gated <mark>approvals</mark> \\`destructive: true\\`",
    );
  });

  it("leaves no line start for a code fence to open on", () => {
    expect(markSnippet("see:\n\n```sh\ngraft <b>approve</b>\n```")).toBe(
      "see: \\`\\`\\`sh graft <mark>approve</mark> \\`\\`\\`",
    );
  });

  it("defuses a list marker that would open a block at index 0", () => {
    expect(markSnippet("- an <b>approval</b> row")).toBe("\\- an <mark>approval</mark> row");
  });

  it("escapes an ordered marker on its delimiter, not its digit", () => {
    // CommonMark honours a backslash only before ASCII punctuation, so "\1."
    // would render the backslash itself.
    expect(markSnippet("1. file the <b>approval</b>")).toBe("1\\. file the <mark>approval</mark>");
    expect(markSnippet("12) then <b>approve</b>")).toBe("12\\) then <mark>approve</mark>");
  });

  it("leaves a hyphen alone when it is not opening a list", () => {
    expect(markSnippet("read-only <b>approval</b> - see docs")).toBe(
      "read-only <mark>approval</mark> - see docs",
    );
  });
});

describe("headingForSnippet", () => {
  const body = [
    "intro prose about the system",
    "",
    "## Approvals",
    "",
    "a destructive call files an approval row before it runs",
    "",
    "## Audit",
    "",
    "every invocation writes an approval-shaped audit row",
  ].join("\n");
  const headings = extractHeadings(body);

  it("anchors a snippet to the section it was quoted from", () => {
    expect(
      headingForSnippet(body, headings, "writes an <b>approval</b>-shaped audit row")?.id,
    ).toBe("audit");
  });

  it("locates by the unmarked text, not by the term that appears everywhere", () => {
    // "approval" occurs first under Approvals; the quoted run is under Audit.
    // Locating by the marked term alone would name the wrong section.
    expect(headingForSnippet(body, headings, "every invocation <b>writes</b>")?.id).toBe("audit");
  });

  it("matches across a line break, because the body wraps and the snippet does not", () => {
    const wrapped = "## Approvals\n\na destructive call files\nan approval row";
    expect(
      headingForSnippet(wrapped, extractHeadings(wrapped), "call <b>files</b> an approval row")?.id,
    ).toBe("approvals");
  });

  it("splits on the ellipsis joining two ts_headline fragments", () => {
    // The joined string appears nowhere in the body — the two fragments are
    // from different sections — so without the split there is no locator long
    // enough to match and the snippet would go unanchored. Split, each
    // fragment is searched on its own and the longest wins, which is the one
    // the snippet opens with.
    expect(
      headingForSnippet(body, headings, "destructive call ... every <b>invocation</b> writes")?.id,
    ).toBe("approvals");
  });

  it("returns undefined when the match is above the first heading", () => {
    expect(
      headingForSnippet(body, headings, "<b>intro</b> prose about the system"),
    ).toBeUndefined();
  });

  it("returns undefined rather than guessing when the text is not in the body", () => {
    expect(headingForSnippet(body, headings, "<b>nonexistent</b> phrasing here")).toBeUndefined();
  });

  it("has nothing to anchor to when the document has no headings", () => {
    expect(headingForSnippet("just prose", [], "<b>prose</b>")).toBeUndefined();
  });
});

describe("toSearchResults", () => {
  const hit: SearchSourceHit = {
    slug: "errors",
    title: "Errors",
    body: ["## Codes", "", "### APPROVAL_INVALID", "", "the approval was already consumed"].join(
      "\n",
    ),
    snippet: "the <b>approval</b> was already consumed",
  };

  it("emits a page, the matching headings, and the anchored snippet", () => {
    expect(toSearchResults([hit], "approval")).toEqual([
      { id: "errors", url: "/docs/errors", type: "page", content: "Errors" },
      {
        id: "errors-approval_invalid",
        url: "/docs/errors#approval_invalid",
        type: "heading",
        content: "APPROVAL_INVALID",
      },
      {
        id: "errors-snippet",
        url: "/docs/errors#approval_invalid",
        type: "text",
        content: "the <mark>approval</mark> was already consumed",
      },
    ]);
  });

  it("skips headings that do not match, so a long page does not flood the list", () => {
    const results = toSearchResults([hit], "consumed");

    expect(results.filter(({ type }) => type === "heading")).toEqual([]);
    expect(results.map(({ type }) => type)).toEqual(["page", "text"]);
  });

  it("ignores one-character query terms when matching headings", () => {
    expect(toSearchResults([hit], "a").filter(({ type }) => type === "heading")).toEqual([]);
  });

  it("omits the snippet entry when ts_headline returned nothing", () => {
    const results = toSearchResults([{ ...hit, snippet: "   " }], "approval");

    expect(results.map(({ type }) => type)).toEqual(["page", "heading"]);
  });
});
