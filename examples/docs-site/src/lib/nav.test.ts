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
        doc("operate-later", "Operate", 2),
        doc("unknown-b", "Troubleshooting", 1),
        doc("build-unordered", "Build"),
        doc("start", "Start here", 1),
        doc("build-first", "Build", 1),
        doc("unknown-a", "Appendix", 1),
        doc("operate-first", "Operate", 1),
      ],
      SECTION_ORDER,
    );

    expect(grouped.map(({ section }) => section)).toEqual([
      "Start here",
      "Build",
      "Operate",
      "Appendix",
      "Troubleshooting",
    ]);
    expect(grouped.map(({ entries }) => entries.map(({ slug }) => slug))).toEqual([
      ["start"],
      ["build-first", "build-unordered"],
      ["operate-first", "operate-later"],
      ["unknown-a"],
      ["unknown-b"],
    ]);
  });
});
