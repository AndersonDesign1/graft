/** Unit: the cache-tag contract (pure). */
import type { ChangeSet } from "@usegraft/db";
import { describe, expect, it } from "vitest";
import { collectionTag, documentTag, MAX_TAG_LENGTH, tagsFor, tagsForChanges } from "./tags";

describe("tag builders", () => {
  it("document and collection tags are distinct and structured", () => {
    expect(documentTag("main", "pages", "home")).toBe("graft:main:pages:home");
    expect(collectionTag("main", "pages")).toBe("graft:main:pages");
  });

  it("scopes by branch (a preview never shares tags with main)", () => {
    expect(documentTag("preview/x", "pages", "home")).toBe("graft:preview/x:pages:home");
    expect(documentTag("preview/x", "pages", "home")).not.toBe(
      documentTag("main", "pages", "home"),
    );
  });

  it("keeps a long slug's tag within Next's 256-character limit, the same way every time", () => {
    // Next skips a longer tag, so the page it guards would never refresh.
    const long = "a".repeat(300);
    const tag = documentTag("main", "pages", long);

    expect(tag.length).toBeLessThanOrEqual(MAX_TAG_LENGTH);
    expect(tag.startsWith("graft:main:pages:aaa")).toBe(true);
    // Reads and invalidation both build it here, so they must agree.
    expect(documentTag("main", "pages", long)).toBe(tag);
    expect(
      tagsForChanges("main", { added: [`pages/${long}`], changed: [], removed: [], unchanged: 0 }),
    ).toContain(tag);
    // Two long slugs that differ only past the cut still get different tags.
    expect(documentTag("main", "pages", `${long}b`)).not.toBe(
      documentTag("main", "pages", `${long}c`),
    );
  });
});

describe("tagsFor (read registration)", () => {
  it("a document read registers only its doc tag", () => {
    expect(tagsFor("main", "pages", "home")).toEqual(["graft:main:pages:home"]);
  });

  it("a list/search read (no slug) registers the collection tag", () => {
    expect(tagsFor("main", "pages")).toEqual(["graft:main:pages"]);
  });
});

describe("tagsForChanges (write invalidation)", () => {
  const empty: ChangeSet = { added: [], changed: [], removed: [], unchanged: 0 };

  it("emits the doc tag AND the collection tag for every touched doc", () => {
    const changes: ChangeSet = {
      added: ["pages/about"],
      changed: ["pages/home"],
      removed: ["posts/old"],
      unchanged: 5,
    };
    expect(tagsForChanges("main", changes).sort()).toEqual(
      [
        "graft:main:pages",
        "graft:main:pages:about",
        "graft:main:pages:home",
        "graft:main:posts",
        "graft:main:posts:old",
      ].sort(),
    );
  });

  it("deduplicates the collection tag across many docs in one collection", () => {
    const changes: ChangeSet = {
      added: ["pages/a", "pages/b"],
      changed: ["pages/c"],
      removed: [],
      unchanged: 0,
    };
    const tags = tagsForChanges("main", changes);
    expect(tags.filter((t) => t === "graft:main:pages")).toHaveLength(1);
    expect(tags).toContain("graft:main:pages:a");
    expect(tags).toContain("graft:main:pages:b");
    expect(tags).toContain("graft:main:pages:c");
  });

  it("an unchanged-only compile invalidates nothing (the hash-diff payoff)", () => {
    expect(tagsForChanges("main", { ...empty, unchanged: 42 })).toEqual([]);
  });

  it("scopes invalidation to the compiled branch", () => {
    const changes: ChangeSet = { added: ["pages/home"], changed: [], removed: [], unchanged: 0 };
    expect(tagsForChanges("preview/x", changes)).toEqual([
      "graft:preview/x:pages",
      "graft:preview/x:pages:home",
    ]);
  });
});
