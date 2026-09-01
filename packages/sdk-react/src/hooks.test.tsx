/**
 * Unit: the hooks, rendered for real in jsdom, because the parts that can
 * break are the parts `useEffect` owns — when a read is re-run, and which
 * answer is allowed to win when two are in flight.
 *
 * Reads are hand-settled rather than resolved immediately. A test that awaits
 * a promise which was already resolved cannot tell a correct implementation
 * from one that ignores its cleanup.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { defineCollection, field } from "@usegraft/core";
import type { AnyCollection, ClientOptions, Document, SearchHit } from "@usegraft/sdk-core";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createGraft, type Graft } from "./graft";
import { createGraftHooks, type AsyncState } from "./hooks";

// Vitest does not install global lifecycle hooks, so Testing Library's
// automatic cleanup never registers itself. Unmounting between tests is what
// keeps one test's in-flight read out of the next one.
afterEach(cleanup);

const docs = defineCollection({
  name: "docs",
  fields: { title: field.string(), order: field.number({ optional: true }) },
});

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

interface PendingRead {
  slug: string | undefined;
  settle: (rows: Row[]) => void;
  fail: (cause: unknown) => void;
}

/** A reader whose reads hang until the test says otherwise. */
function controllable() {
  const reads: PendingRead[] = [];
  const index: Reader = {
    readContent(options) {
      return new Promise((resolve, reject) => {
        reads.push({ slug: options.slug, settle: resolve, fail: reject });
      });
    },
    async searchContent() {
      return [{ row: row("intro", "Intro"), rank: 0.5, snippet: "<b>Intro</b>" }];
    },
    async close() {},
  };
  return { reads, graft: createGraft({ index, collections: { docs } }) };
}

describe("useContent", () => {
  it("reports loading, then the document", async () => {
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useContent("docs", "intro"));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await act(async () => reads[0].settle([row("intro", "Intro")]));

    expect(result.current.loading).toBe(false);
    expect(result.current.data?.data.title).toBe("Intro");
    expect(result.current.error).toBeUndefined();
  });

  it("reports the error and no data when the read fails", async () => {
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useContent("docs", "intro"));

    await act(async () => reads[0].fail(new Error("offline")));

    expect(result.current.error?.message).toBe("offline");
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it("re-reads when the slug changes and never shows the previous document", async () => {
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result, rerender } = renderHook(({ slug }) => hooks.useContent("docs", slug), {
      initialProps: { slug: "intro" },
    });

    await act(async () => reads[0].settle([row("intro", "Intro")]));
    expect(result.current.data?.slug).toBe("intro");

    rerender({ slug: "advanced" });

    // No stale-while-revalidate here: `data` answers the current arguments or
    // it is undefined. Holding the old document would be a cache, and a cache
    // is the thing this package deliberately does not have.
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(reads).toHaveLength(2);
  });

  it("drops a read that settles after its arguments changed", async () => {
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result, rerender } = renderHook(({ slug }) => hooks.useContent("docs", slug), {
      initialProps: { slug: "intro" },
    });

    rerender({ slug: "advanced" });

    // The second read answers first, then the abandoned first one lands. The
    // slow answer to a question nobody is asking any more must not win.
    await act(async () => reads[1].settle([row("advanced", "Advanced")]));
    await act(async () => reads[0].settle([row("intro", "Intro")]));

    expect(result.current.data?.slug).toBe("advanced");
  });

  it("re-runs the read on refresh", async () => {
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useContent("docs", "intro"));

    await act(async () => reads[0].settle([row("intro", "Intro")]));
    act(() => result.current.refresh());

    expect(reads).toHaveLength(2);
    await act(async () => reads[1].settle([row("intro", "Intro, edited")]));
    expect(result.current.data?.data.title).toBe("Intro, edited");
  });

  it("does not re-read when the caller passes a fresh options object each render", async () => {
    // The options argument is a new object on every render. Keying the effect
    // on it would loop forever, which is why the hooks key on the primitives
    // inside it instead.
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { rerender } = renderHook(() => hooks.useContent("docs", "intro", { branch: "main" }));

    rerender();
    rerender();

    expect(reads).toHaveLength(1);
  });
});

describe("useContentList and useContentSearch", () => {
  it("lists a collection", async () => {
    const { reads, graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useContentList("docs"));

    await act(async () => reads[0].settle([row("intro", "Intro"), row("advanced", "Advanced")]));

    expect(result.current.data?.map((doc) => doc.slug)).toEqual(["intro", "advanced"]);
  });

  it("searches, keeping rank and snippet", async () => {
    const { graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useContentSearch("docs", "intro"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.[0].rank).toBe(0.5);
    expect(result.current.data?.[0].snippet).toBe("<b>Intro</b>");
  });
});

describe("GraftProvider", () => {
  it("reads the factory's handle when no provider is mounted", () => {
    const { graft } = controllable();
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useGraft());

    expect(result.current).toBe(graft);
  });

  it("lets a subtree read somewhere else", () => {
    // The seam that makes a preview branch, or a fake in a test, possible
    // without rebuilding the hooks.
    const { graft } = controllable();
    const elsewhere = controllable().graft;
    const hooks = createGraftHooks(graft);
    const { result } = renderHook(() => hooks.useGraft(), {
      wrapper: ({ children }) => (
        <hooks.GraftProvider graft={elsewhere}>{children}</hooks.GraftProvider>
      ),
    });

    expect(result.current).toBe(elsewhere);
  });
});

describe("hook type inference", () => {
  it("keeps the document type the schema declared", () => {
    const hooks = createGraftHooks(createGraft({ index: {} as never, collections: { docs } }));

    expectTypeOf(hooks.useContent<"docs">).returns.toEqualTypeOf<
      AsyncState<Document<typeof docs> | null>
    >();
    expectTypeOf(hooks.useContentList<"docs">).returns.toEqualTypeOf<
      AsyncState<Document<typeof docs>[]>
    >();
    expectTypeOf(hooks.useContentSearch<"docs">).returns.toEqualTypeOf<
      AsyncState<SearchHit<typeof docs>[]>
    >();
    // Unknown collection names are compile errors, not runtime surprises.
    expectTypeOf(hooks.useContent).parameter(0).toEqualTypeOf<"docs">();
    expectTypeOf(hooks.useGraft).returns.toEqualTypeOf<Graft<{ docs: typeof docs }>>();
  });
});
