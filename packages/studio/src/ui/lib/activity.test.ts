import { describe, expect, it } from "vitest";
import type { ActivityEventDto } from "../../editor-types";
import { groupActivity } from "./activity";

const doc = (slug: string) => ({
  path: `projects/${slug}.mdx`,
  collection: "projects",
  slug,
  title: slug,
});

function event(id: string, by: string, slugs: string[], message?: string): ActivityEventDto {
  const made: ActivityEventDto = {
    id,
    at: `2026-10-15T10:0${id}:00.000Z`,
    by,
    documents: slugs.map(doc),
    more: 0,
  };
  if (message) made.message = message;
  return made;
}

describe("groupActivity", () => {
  it("folds a run of the same person changing the same entry, keeping the newest", () => {
    const groups = groupActivity([
      event("4", "Ada", ["kyrus"]),
      event("3", "Ada", ["kyrus"]),
      event("2", "Ada", ["kyrus"]),
      event("1", "Ada", ["welup"]),
    ]);
    expect(groups.map((g) => [g.event.id, g.times])).toEqual([
      ["4", 3],
      ["1", 1],
    ]);
  });

  it("keeps changes apart when the person, the documents or the order differ", () => {
    const groups = groupActivity([
      event("4", "Ada", ["kyrus"]),
      event("3", "Grace", ["kyrus"]),
      event("2", "Ada", ["kyrus", "welup"]),
      event("1", "Ada", ["kyrus"]),
    ]);
    expect(groups.map((g) => g.times)).toEqual([1, 1, 1, 1]);
  });

  it("folds events without documents only when their message matches", () => {
    const groups = groupActivity([
      event("3", "Ada", [], "Update projects"),
      event("2", "Ada", [], "Update projects"),
      event("1", "Ada", [], "Fix typo"),
    ]);
    expect(groups.map((g) => g.times)).toEqual([2, 1]);
  });
});
