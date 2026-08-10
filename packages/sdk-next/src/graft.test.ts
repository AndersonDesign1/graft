/**
 * Unit: the sdk-next write side — mapping a compile's ChangeSet onto Next's
 * revalidateTag/updateTag. next/cache and react's cache are mocked so the test
 * is pure (no RSC runtime, no database); the tag contract itself is real.
 */
import { defineCollection, field } from "@usegraft/core";
import type { Document, SearchHit } from "@usegraft/sdk-core";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const revalidateTag = vi.fn();
const updateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile: unknown) => revalidateTag(tag, profile),
  updateTag: (tag: string) => updateTag(tag),
}));
// React.cache outside a render is just pass-through here.
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));

// Imported after the mocks are registered.
const { createGraft, revalidateContent, updateContent } = await import("./graft");

beforeEach(() => {
  revalidateTag.mockClear();
  updateTag.mockClear();
});

const CHANGES = {
  added: ["pages/about"],
  changed: ["pages/home"],
  removed: [] as string[],
  unchanged: 3,
};
const EXPECTED = ["graft:main:pages", "graft:main:pages:about", "graft:main:pages:home"];

describe("revalidateContent", () => {
  it("background-revalidates once per changed tag and returns them", () => {
    const tags = revalidateContent("main", { ...CHANGES });
    expect(tags.sort()).toEqual(EXPECTED.sort());
    expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual(EXPECTED.sort());
  });

  it('defaults the required Next 16 cache-life profile to "max"', () => {
    revalidateContent("main", { ...CHANGES });
    for (const call of revalidateTag.mock.calls) expect(call[1]).toBe("max");
  });

  it("threads an explicit profile through", () => {
    revalidateContent(
      "main",
      { added: ["pages/home"], changed: [], removed: [], unchanged: 0 },
      {
        expire: 60,
      },
    );
    expect(revalidateTag.mock.calls[0]?.[1]).toEqual({ expire: 60 });
  });

  it("an unchanged-only compile revalidates nothing", () => {
    expect(
      revalidateContent("main", { added: [], changed: [], removed: [], unchanged: 9 }),
    ).toEqual([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("scopes to the compiled branch", () => {
    revalidateContent("preview/x", {
      added: ["pages/home"],
      changed: [],
      removed: [],
      unchanged: 0,
    });
    expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual([
      "graft:preview/x:pages",
      "graft:preview/x:pages:home",
    ]);
  });
});

describe("updateContent", () => {
  it("immediately invalidates once per changed tag (single-arg updateTag)", () => {
    const tags = updateContent("main", { ...CHANGES });
    expect(tags.sort()).toEqual(EXPECTED.sort());
    expect(updateTag.mock.calls.map((c) => c[0]).sort()).toEqual(EXPECTED.sort());
    for (const call of updateTag.mock.calls) expect(call).toHaveLength(1);
  });
});

describe("createGraft type inference", () => {
  // The no-codegen contract must survive the React.cache wrappers: a schema
  // defined in graft.config.ts types every read in a Server Component. Assert
  // on the function types — invoking them would hit the fake db.
  const pages = defineCollection({
    name: "pages",
    fields: { title: field.string(), order: field.number({ optional: true }) },
  });

  it("getContent/listContent/searchContent keep the exact document type", () => {
    const graft = createGraft({ db: {} as never, collections: { pages } });
    expectTypeOf(graft.getContent<"pages">).returns.resolves.toEqualTypeOf<Document<
      typeof pages
    > | null>();
    expectTypeOf(graft.listContent<"pages">).returns.resolves.toEqualTypeOf<
      Document<typeof pages>[]
    >();
    expectTypeOf(graft.searchContent<"pages">).returns.resolves.toEqualTypeOf<
      SearchHit<typeof pages>[]
    >();
    // Unknown collection names are compile errors, not runtime surprises.
    expectTypeOf(graft.getContent).parameter(0).toEqualTypeOf<"pages">();
  });

  it("keeps the same inference when reading a static index instead of a database", () => {
    // Zero-service projects pass a ContentIndexReader; the typed surface and
    // the no-codegen contract must not depend on which index is behind it.
    const graft = createGraft({ index: {} as never, collections: { pages } });
    expectTypeOf(graft.getContent<"pages">).returns.resolves.toEqualTypeOf<Document<
      typeof pages
    > | null>();
    expectTypeOf(graft.searchContent<"pages">).returns.resolves.toEqualTypeOf<
      SearchHit<typeof pages>[]
    >();
  });
});
