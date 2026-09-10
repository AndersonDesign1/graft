import { describe, expect, it } from "vitest";
import { groupDocsNav, SECTION_ORDER, type DocNavSourceEntry } from "./nav";

const doc = (slug: string, section: string, order?: number): DocNavSourceEntry => ({
  slug,
  section,
  order,
  title: slug,
  description: `${slug} description`,
});

describe("groupDocsNav", () => {
  it("sorts declared sections and their pages while retaining unknown sections", () => {
    const grouped = groupDocsNav(
      [
        doc("concepts-later", "Core Concepts", 2),
        doc("unknown-b", "Troubleshooting", 1),
        doc("frameworks-unordered", "Frameworks & Adapters"),
        doc("start", "Get Started", 1),
        doc("frameworks-first", "Frameworks & Adapters", 1),
        doc("unknown-a", "Appendix", 1),
        doc("concepts-first", "Core Concepts", 1),
      ],
      SECTION_ORDER,
    );

    expect(grouped.map(({ section }) => section)).toEqual([
      "Get Started",
      "Frameworks & Adapters",
      "Core Concepts",
      "Appendix",
      "Troubleshooting",
    ]);
    expect(grouped.map(({ entries }) => entries.map(({ slug }) => slug))).toEqual([
      ["start"],
      ["frameworks-first", "frameworks-unordered"],
      ["concepts-first", "concepts-later"],
      ["unknown-a"],
      ["unknown-b"],
    ]);
  });
});

/**
 * The /docs redirect target is written out in astro.config.mjs because config
 * is evaluated before the content index is guaranteed to exist. That buys a
 * real edge redirect at the cost of a copy, so this pins the copy: reordering
 * the sidebar, or renaming the first doc, fails here instead of shipping a
 * /docs that lands on a stale page or a 404.
 */
describe("the /docs redirect", () => {
  it("points at whatever docsNav puts first", async () => {
    const [{ readFileSync }, { docsNav }] = await Promise.all([import("node:fs"), import("./nav")]);

    const config = readFileSync(new URL("../../astro.config.mjs", import.meta.url), "utf8");
    const target = config.match(/"\/docs":\s*"\/docs\/([a-z0-9-]+)"/)?.[1];

    expect(target, "no /docs redirect found in astro.config.mjs").toBeDefined();
    expect(target).toBe((await docsNav())[0]?.entries[0]?.slug);
  });
});
