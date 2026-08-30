/**
 * The contract search-results.ts depends on and cannot assert about itself:
 * the heading id it computes from the MDX source must equal the id rehype-slug
 * puts on the rendered page. If they diverge, search hands out anchors that
 * scroll nowhere — a failure that looks like nothing at all, because the page
 * still loads.
 *
 * Run against the real corpus rather than fixtures. A fixture only proves the
 * stripper handles the markup someone thought to write a fixture for, and the
 * first run of this test found the opposite: three docs are CRLF, and the
 * heading scan silently reported zero headings for every one of them. No
 * fixture in this repo had a \r in it.
 *
 * It renders every doc through the real pipeline, so it is the slowest test
 * here. That is the price of the only check that can catch a rehype-slug
 * upgrade changing how it slugs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMdx } from "./mdx";
import { extractHeadings } from "./search-results";

const DOCS_DIR = join(process.cwd(), "content", "docs");
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const RENDERED_HEADING_ID = /<h[1-6][^>]*\bid="([^"]+)"/g;

describe("heading anchor parity", () => {
  const files = readdirSync(DOCS_DIR).filter((name) => name.endsWith(".mdx"));

  it("found the docs to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file}: extracted ids equal the rendered ids`, async () => {
      const body = readFileSync(join(DOCS_DIR, file), "utf8").replace(FRONTMATTER, "");
      const html = await renderMdx(body);

      const rendered = [...html.matchAll(RENDERED_HEADING_ID)].map((match) => match[1]);
      expect(extractHeadings(body).map((heading) => heading.id)).toEqual(rendered);
    });
  }
});
