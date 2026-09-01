import { describe, expect, it } from "vitest";
import { renderDocMarkdown, renderLlmsFull, renderLlmsIndex, textResponse } from "./llms";
import type { DocNavSection } from "./nav";

const sections: DocNavSection[] = [
  {
    section: "Start here",
    entries: [
      { slug: "what-is-graft", title: "What is Graft", description: "The short version." },
      { slug: "getting-started", title: "Getting started", description: "Zero to a page." },
    ],
  },
  {
    section: "Reference",
    entries: [{ slug: "errors", title: "Error reference", description: "All 42 codes." }],
  },
];

const ORIGIN = "https://graft.example";

describe("renderLlmsIndex", () => {
  const index = renderLlmsIndex(sections, ORIGIN);

  it("opens with the H1 and a blockquote summary, per llmstxt.org", () => {
    const [first, , third] = index.split("\n");
    expect(first).toBe("# Graft");
    expect(third.startsWith("> ")).toBe(true);
  });

  it("keeps the sidebar's section order and names", () => {
    expect(index.match(/^## .+$/gm)).toEqual(["## Start here", "## Reference"]);
  });

  it("links to the .md, not the HTML page — the point is to skip the parse", () => {
    expect(index).toContain(
      "- [Getting started](https://graft.example/docs/getting-started.md): Zero to a page.",
    );
    expect(index).not.toContain("](https://graft.example/docs/getting-started)");
  });

  it("resolves links against whatever origin served the request", () => {
    expect(renderLlmsIndex(sections, "http://localhost:4321")).toContain(
      "http://localhost:4321/docs/errors.md",
    );
  });
});

describe("renderDocMarkdown", () => {
  it("gives the body a single H1 and its summary, so the file stands alone", () => {
    expect(
      renderDocMarkdown({
        title: "Schema",
        description: "defineCollection and field builders.",
        body: "\n## defineCollection\n\nDefine collections.\n\n",
      }),
    ).toBe(
      "# Schema\n\n> defineCollection and field builders.\n\n## defineCollection\n\nDefine collections.\n",
    );
  });
});

describe("renderLlmsFull", () => {
  const bodies = new Map([
    [
      "what-is-graft",
      { title: "What is Graft", description: "The short version.", body: "Prose." },
    ],
    ["errors", { title: "Error reference", description: "All 42 codes.", body: "## Codes" }],
  ]);

  it("inlines the documents it has, in reading order, with their source URLs", () => {
    const full = renderLlmsFull(sections, bodies, ORIGIN);

    expect(full.indexOf("# What is Graft")).toBeLessThan(full.indexOf("# Error reference"));
    expect(full).toContain("<!-- source: https://graft.example/docs/what-is-graft -->");
    expect(full).toContain("<!-- section: Reference -->");
  });

  it("skips a nav entry with no body rather than emitting an empty document", () => {
    // docsNav and listContent are two reads; a document can appear in one and
    // not the other for the moment between a compile and a request.
    const full = renderLlmsFull(sections, bodies, ORIGIN);

    expect(full).not.toContain("Getting started");
    expect(full.match(/^# .+$/gm)).toEqual([
      "# Graft — full documentation",
      "# What is Graft",
      "# Error reference",
    ]);
  });
});

describe("textResponse", () => {
  it("declares utf-8 and is cacheable at the edge but never stale-wrong", () => {
    const response = textResponse("body", "text/markdown");

    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");
  });
});
