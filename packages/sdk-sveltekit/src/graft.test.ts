/**
 * Unit: the type-inference pins (the no-codegen contract must survive this
 * adapter exactly as it does sdk-next's — asserted on types, invoking would
 * hit the fake db) and the graftRoute mount (a real Request round-trips
 * through the structural RequestEvent shape).
 */
import { defineCollection, field } from "@graft/core";
import type { Document, SearchHit } from "@graft/sdk-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createGraft } from "./graft";
import { graftRoute } from "./routes";

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
});

describe("graftRoute", () => {
  it("hands the event's request to the Graft handler and returns its response", async () => {
    const route = graftRoute(async (request) =>
      Response.json({ method: request.method, path: new URL(request.url).pathname }),
    );
    const response = await route({
      request: new Request("http://site.test/api/mcp", { method: "POST" }),
    });
    expect(await response.json()).toEqual({ method: "POST", path: "/api/mcp" });
  });
});
