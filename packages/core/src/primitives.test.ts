import { GraftError } from "@usegraft/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineCollection } from "./collection";
import { field } from "./field";
import { defineFunction } from "./function";
import { mergePrimitives } from "./primitives";

const pages = defineCollection({ name: "pages", fields: { title: field.string() } });
const comments = defineCollection({
  name: "comments",
  authority: "db-authoritative",
  fields: { body: field.string() },
});
const listComments = defineFunction({
  name: "listComments",
  kind: "query",
  input: {},
  handler: () => ({ comments: [] }),
});

describe("mergePrimitives", () => {
  it("merges collections and functions across modules", () => {
    const merged = mergePrimitives([
      { collections: { pages } },
      { collections: { comments }, functions: { listComments } },
    ]);
    expect(Object.keys(merged.collections)).toEqual(["pages", "comments"]);
    expect(Object.keys(merged.functions)).toEqual(["listComments"]);
    expect(merged.collections.comments).toBe(comments);
  });

  it("tolerates empty input and modules with no maps", () => {
    expect(mergePrimitives([])).toEqual({ collections: {}, functions: {} });
    expect(mergePrimitives([{}, { functions: {} }])).toEqual({ collections: {}, functions: {} });
  });

  it("types the empty merge as empty maps, not unknown — the fresh `graft init` barrel", () => {
    // graft init generates `mergePrimitives([])`; its result must still satisfy
    // PrimitiveModule so graft.config.ts can merge the barrel before any
    // `graft add`. UnionToIntersection<never> = unknown would break that.
    const empty = mergePrimitives([]);
    expectTypeOf(empty.collections).not.toBeUnknown();
    expectTypeOf(empty.functions).not.toBeUnknown();
    const remerged = mergePrimitives([{ collections: { pages } }, empty]);
    expectTypeOf(remerged.collections.pages).toEqualTypeOf<typeof pages>();
  });

  it("preserves precise types — the no-codegen inference contract survives merging", () => {
    const merged = mergePrimitives([
      { collections: { pages } },
      { collections: { comments }, functions: { listComments } },
    ]);
    expectTypeOf(merged.collections.pages).toEqualTypeOf<typeof pages>();
    expectTypeOf(merged.collections.comments).toEqualTypeOf<typeof comments>();
    expectTypeOf(merged.functions.listComments).toEqualTypeOf<typeof listComments>();
    // @ts-expect-error — a key that was never merged is not on the merged type
    // (proves no index-signature widening leaked in).
    expect(merged.collections.nope).toBeUndefined();
  });

  it("rejects a duplicate collection key across modules with CONFIG_INVALID", () => {
    const other = defineCollection({ name: "comments-v2", fields: { body: field.string() } });
    try {
      mergePrimitives([{ collections: { comments } }, { collections: { comments: other } }]);
      expect.unreachable("expected a duplicate-key throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GraftError);
      const ge = error as GraftError;
      expect(ge.code).toBe("CONFIG_INVALID");
      expect(ge.details).toMatchObject({ kind: "collection", key: "comments" });
      expect(ge.fix).toBeTruthy();
    }
  });

  it("rejects a duplicate function key across modules with CONFIG_INVALID", () => {
    expect(() =>
      mergePrimitives([{ functions: { listComments } }, { functions: { listComments } }]),
    ).toThrow(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        details: { kind: "function", key: "listComments" },
      }),
    );
  });
});
