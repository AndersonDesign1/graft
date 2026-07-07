/**
 * Unit: the sdk-next write side — mapping a compile's ChangeSet onto Next's
 * revalidateTag/updateTag. next/cache and react's cache are mocked so the test
 * is pure (no RSC runtime, no database); the tag contract itself is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
const updateTag = vi.fn();

vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile: unknown) => revalidateTag(tag, profile),
  updateTag: (tag: string) => updateTag(tag),
}));
// React.cache outside a render is just pass-through here.
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));

// Imported after the mocks are registered.
const { revalidateContent, updateContent } = await import("./graft");

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
