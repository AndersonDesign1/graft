/**
 * Unit: the type-inference pins (the no-codegen contract has to survive a
 * client that reads over HTTP exactly as it survives one that reads Postgres),
 * the two configurations this package refuses, and a round trip through the
 * real content API handler — no network, no database, the actual wire format.
 */
import { createContentApiHandler } from "@usegraft/content-api";
import { defineCollection, field } from "@usegraft/core";
import type { AnyCollection, ClientOptions, Document, SearchHit } from "@usegraft/sdk-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createGraft } from "./graft";

const docs = defineCollection({
  name: "docs",
  fields: { title: field.string(), order: field.number({ optional: true }) },
});

/**
 * The row shape taken from the reader contract rather than copied from it, so
 * a change to what an index row carries breaks this fixture at compile time.
 */
type Reader = NonNullable<ClientOptions<Record<string, AnyCollection>>["index"]>;
type Row = Awaited<ReturnType<Reader["readContent"]>>[number];

function row(slug: string, title: string): Row {
  return {
    branchId: "main",
    collection: "docs",
    slug,
    data: { title },
    body: `# ${title}`,
    contentHash: `sha256:${slug}`,
    sourcePath: `docs/${slug}.mdx`,
    deleted: false,
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
    search: null,
  };
}

const ROWS = [row("intro", "Intro"), row("advanced", "Advanced")];

const index: Reader = {
  async readContent(options) {
    return options.slug === undefined
      ? ROWS
      : ROWS.filter((candidate) => candidate.slug === options.slug);
  },
  async searchContent() {
    return [{ row: ROWS[0], rank: 0.9, snippet: "<b>Intro</b>" }];
  },
  async close() {},
};

/** The handler a `graft serve` mounts, wired straight to fetch. */
function servedGraft() {
  const handler = createContentApiHandler({ collections: ["docs"], branch: "main", index });
  return createGraft({
    endpoint: "http://cms.test/api/content/v1",
    collections: { docs },
    fetch: async (input, init) => handler(new Request(input, init)),
  });
}

describe("createGraft type inference", () => {
  it("getContent/listContent/searchContent keep the exact document type", () => {
    const graft = createGraft({ index: {} as never, collections: { docs } });
    expectTypeOf(graft.getContent<"docs">).returns.resolves.toEqualTypeOf<Document<
      typeof docs
    > | null>();
    expectTypeOf(graft.listContent<"docs">).returns.resolves.toEqualTypeOf<
      Document<typeof docs>[]
    >();
    expectTypeOf(graft.searchContent<"docs">).returns.resolves.toEqualTypeOf<
      SearchHit<typeof docs>[]
    >();
    // Unknown collection names are compile errors, not runtime surprises.
    expectTypeOf(graft.getContent).parameter(0).toEqualTypeOf<"docs">();
  });

  it("keeps the same inference when the data arrives over HTTP", () => {
    // The whole design claim: types come from the collections import, not from
    // the response, so an endpoint-backed handle is typed identically to a
    // reader-backed one.
    const graft = servedGraft();
    expectTypeOf(graft.getContent<"docs">).returns.resolves.toEqualTypeOf<Document<
      typeof docs
    > | null>();
    expectTypeOf(graft.searchContent<"docs">).returns.resolves.toEqualTypeOf<
      SearchHit<typeof docs>[]
    >();
  });
});

describe("createGraft configuration", () => {
  it("refuses a handle with nowhere to read from", () => {
    expect(() => createGraft({ collections: { docs } })).toThrowError(/pass `endpoint` or `index`/);
  });

  it("refuses branch alongside endpoint, which the wire would have dropped", () => {
    // The content API pins its branch server-side and rejects a branch query
    // param, so the reader never sends one. Left unchecked, this option would
    // read main while the caller believed they were reading a preview.
    expect(() =>
      createGraft({
        endpoint: "http://cms.test/api/content/v1",
        branch: "preview/redesign",
        collections: { docs },
      }),
    ).toThrowError(/cannot be combined with `endpoint`/);
  });

  it("refuses a per-read branch on an endpoint-backed handle", async () => {
    // The constructor check above only covers the handle. A branch passed to an
    // individual read reaches the same dead end — the reader never sends it and
    // the server would refuse it — so it has to fail here too, not resolve to
    // main.
    const graft = servedGraft();
    await expect(graft.getContent("docs", "intro", { branch: "preview/redesign" })).rejects.toThrow(
      /`branch` cannot be passed to a read/,
    );
    await expect(graft.listContent("docs", { branch: "preview/redesign" })).rejects.toThrow(
      /`branch` cannot be passed to a read/,
    );
    await expect(
      graft.searchContent("docs", "intro", { branch: "preview/redesign" }),
    ).rejects.toThrow(/`branch` cannot be passed to a read/);
  });

  it("still allows a per-read branch when the handle owns its own index", async () => {
    // An index-backed handle is not pinned by a server, so the guard must not
    // fire there — otherwise it would break the one configuration where a
    // branch is meaningful.
    const graft = createGraft({ index, collections: { docs } });
    await expect(graft.listContent("docs", { branch: "main" })).resolves.toBeInstanceOf(Array);
  });
});

describe("reads over the content API", () => {
  it("gets one document, typed and re-validated against the schema", async () => {
    const doc = await servedGraft().getContent("docs", "intro");

    expect(doc?.slug).toBe("intro");
    expect(doc?.data.title).toBe("Intro");
    expect(doc?.body).toBe("# Intro");
    expect(doc?.sourcePath).toBe("docs/intro.mdx");
    // Serialized as a string on the wire and parsed back on arrival.
    expect(doc?.updatedAt).toBeInstanceOf(Date);
  });

  it("returns null for a slug the collection does not have", async () => {
    expect(await servedGraft().getContent("docs", "missing")).toBeNull();
  });

  it("lists a collection", async () => {
    const all = await servedGraft().listContent("docs");

    expect(all.map((doc) => doc.slug)).toEqual(["intro", "advanced"]);
  });

  it("searches, keeping the rank and the highlighted snippet", async () => {
    const hits = await servedGraft().searchContent("docs", "intro");

    expect(hits).toHaveLength(1);
    expect(hits[0].rank).toBe(0.9);
    expect(hits[0].snippet).toBe("<b>Intro</b>");
  });

  it("surfaces the server's GraftError rather than an HTTP status", async () => {
    // The endpoint publishes one set of collections; asking for another is the
    // server's error to explain, and it has to survive the trip back.
    const other = defineCollection({ name: "posts", fields: { title: field.string() } });
    const handler = createContentApiHandler({ collections: ["docs"], branch: "main", index });
    const graft = createGraft({
      endpoint: "http://cms.test/api/content/v1",
      collections: { posts: other },
      fetch: async (input, init) => handler(new Request(input, init)),
    });

    await expect(graft.listContent("posts")).rejects.toMatchObject({
      code: "COLLECTION_NOT_FOUND",
    });
  });
});
