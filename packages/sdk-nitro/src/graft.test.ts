/**
 * The type-inference pins: the no-codegen contract must survive this adapter
 * exactly as it does sdk-next's. Asserted on types, because invoking would
 * hit the fake db. The mount is covered in routes.test.ts.
 */
import { defineCollection, field } from "@usegraft/core";
import type { Document, SearchHit } from "@usegraft/sdk-core";
import { describe, expectTypeOf, it } from "vitest";
import { createGraft } from "./graft";

describe("createGraft type inference", () => {
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
