/**
 * The composables, run in a real Vue effect scope. The parts that can break
 * are when a read runs again and which answer is allowed to win when two are
 * in flight, so reads are settled by hand: a test that awaits an
 * already-resolved promise cannot tell a correct implementation from one that
 * ignores stale answers.
 */
import { defineCollection, field } from "@usegraft/core";
import type { AnyCollection, ClientOptions, Document, SearchHit } from "@usegraft/sdk-core";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createApp,
  createSSRApp,
  defineComponent,
  effectScope,
  h,
  nextTick,
  ref,
  watch,
  type Ref,
} from "vue";
import { renderToString } from "vue/server-renderer";
import { createGraftComposables, type ReadState } from "./composables";
import { createGraft } from "./graft";

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

/** A reader whose reads hang until the test settles them. */
function controllable() {
  const reads: PendingRead[] = [];
  const searches: string[] = [];
  const index: Reader = {
    readContent(options) {
      return new Promise((resolve, reject) => {
        reads.push({ slug: options.slug, settle: resolve, fail: reject });
      });
    },
    async searchContent(options) {
      searches.push(options.query);
      return [{ row: row("intro", "Intro"), rank: 0.5, snippet: "<b>Intro</b>" }];
    },
    async close() {},
  };
  return { reads, searches, graft: createGraft({ index, collections: { docs } }) };
}

/** Resolves once `loading` is false. Awaits the state change, never a timer. */
function settled<T>(state: ReadState<T>): Promise<void> {
  if (!state.loading.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(state.loading, (loading) => {
      if (loading) return;
      stop();
      resolve();
    });
  });
}

/**
 * Settle a stale read, then wait until its answer has had every chance to
 * land. A second, live read goes through the same promise chain and is
 * settled right after, so once it reports, the stale answer has arrived too.
 * Without this, a test of "the stale answer is dropped" passes before the
 * stale answer ever reaches the composable.
 */
async function afterStale(
  composables: ReturnType<typeof createGraftComposables<{ docs: typeof docs }>>,
  reads: PendingRead[],
  settleStale: () => void,
): Promise<void> {
  const { value: probe } = inScope(() => composables.useContent("docs", "probe"));
  const probeRead = reads.at(-1);
  settleStale();
  probeRead?.settle([row("probe", "Probe")]);
  await settled(probe);
}

/** Run a composable in its own scope, the way a component's setup does. */
function inScope<T>(make: () => T): { value: T; stop: () => void } {
  const scope = effectScope();
  const value = scope.run(make);
  if (value === undefined) throw new Error("the scope did not run");
  return { value, stop: () => scope.stop() };
}

describe("useContent", () => {
  it("reports loading, then the document", async () => {
    const { reads, graft } = controllable();
    const { useContent } = createGraftComposables(graft);
    const { value: state } = inScope(() => useContent("docs", "intro"));

    expect(state.loading.value).toBe(true);
    expect(state.data.value).toBeUndefined();

    reads[0]?.settle([row("intro", "Intro")]);
    await settled(state);

    expect(state.data.value?.data.title).toBe("Intro");
    expect(state.error.value).toBeUndefined();
  });

  it("reads again when the slug ref changes, and drops the older answer that arrives late", async () => {
    const { reads, graft } = controllable();
    const composables = createGraftComposables(graft);
    const slug = ref("intro");
    const { value: state } = inScope(() => composables.useContent("docs", slug));

    slug.value = "setup";
    await nextTick();
    expect(reads.map((read) => read.slug)).toEqual(["intro", "setup"]);
    expect(state.loading.value).toBe(true);

    reads[1]?.settle([row("setup", "Setup")]);
    await settled(state);
    await afterStale(composables, reads, () => reads[0]?.settle([row("intro", "Intro")]));

    expect(state.data.value?.data.title).toBe("Setup");
  });

  it("drops a failure from the older read that arrives late", async () => {
    const { reads, graft } = controllable();
    const composables = createGraftComposables(graft);
    const slug = ref("intro");
    const { value: state } = inScope(() => composables.useContent("docs", slug));

    slug.value = "setup";
    await nextTick();
    reads[1]?.settle([row("setup", "Setup")]);
    await settled(state);
    await afterStale(composables, reads, () => reads[0]?.fail(new Error("stale")));

    expect(state.error.value).toBeUndefined();
    expect(state.data.value?.data.title).toBe("Setup");
  });

  it("clears the previous answer the moment the arguments change", async () => {
    const { reads, graft } = controllable();
    const { useContent } = createGraftComposables(graft);
    const slug = ref("intro");
    const { value: state } = inScope(() => useContent("docs", slug));
    reads[0]?.settle([row("intro", "Intro")]);
    await settled(state);

    slug.value = "setup";
    await nextTick();

    expect(state.data.value).toBeUndefined();
    expect(state.loading.value).toBe(true);
  });

  it("reads again from a getter, so it follows any reactive source", async () => {
    const { reads, graft } = controllable();
    const { useContent } = createGraftComposables(graft);
    const route = ref({ params: { slug: "intro" } });
    inScope(() => useContent("docs", () => route.value.params.slug));

    route.value = { params: { slug: "faq" } };
    await nextTick();

    expect(reads.map((read) => read.slug)).toEqual(["intro", "faq"]);
  });

  it("reports a failed read as an Error, and refresh reads again", async () => {
    const { reads, graft } = controllable();
    const { useContent } = createGraftComposables(graft);
    const { value: state } = inScope(() => useContent("docs", "intro"));

    reads[0]?.fail("offline");
    await settled(state);
    expect(state.error.value).toBeInstanceOf(Error);
    expect(state.error.value?.message).toBe("offline");

    state.refresh();
    expect(state.loading.value).toBe(true);
    expect(state.error.value).toBeUndefined();
    reads[1]?.settle([row("intro", "Intro")]);
    await settled(state);

    expect(reads).toHaveLength(2);
    expect(state.data.value?.data.title).toBe("Intro");
  });

  it("ignores an answer that arrives after the component is gone", async () => {
    const { reads, graft } = controllable();
    const composables = createGraftComposables(graft);
    const { value: state, stop } = inScope(() => composables.useContent("docs", "intro"));

    stop();
    await afterStale(composables, reads, () => reads[0]?.settle([row("intro", "Intro")]));
    // A refresh kept past disposal starts nothing.
    const before = reads.length;
    state.refresh();
    expect(reads).toHaveLength(before);

    expect(state.data.value).toBeUndefined();
    expect(state.loading.value).toBe(true);
  });
});

describe("useContentList", () => {
  it("reports the collection in index order", async () => {
    const { reads, graft } = controllable();
    const { useContentList } = createGraftComposables(graft);
    const { value: state } = inScope(() => useContentList("docs", { limit: 2 }));

    reads[0]?.settle([row("a", "A"), row("b", "B")]);
    await settled(state);

    expect(state.data.value?.map((doc) => doc.slug)).toEqual(["a", "b"]);
  });
});

describe("useContentSearch", () => {
  it("answers a blank query with no hits and no request, then searches as the query fills in", async () => {
    const { searches, graft } = controllable();
    const { useContentSearch } = createGraftComposables(graft);
    const query: Ref<string> = ref("  ");
    const { value: state } = inScope(() => useContentSearch("docs", query));

    expect(state.loading.value).toBe(false);
    expect(state.data.value).toEqual([]);
    expect(searches).toEqual([]);

    query.value = "intro";
    await nextTick();
    await settled(state);

    expect(searches).toEqual(["intro"]);
    expect(state.data.value?.map((hit) => [hit.slug, hit.snippet])).toEqual([
      ["intro", "<b>Intro</b>"],
    ]);
  });
});

describe("in a component", () => {
  it("sends no read while rendering on the server, and still answers a blank search", async () => {
    const { reads, searches, graft } = controllable();
    const { useContent, useContentSearch } = createGraftComposables(graft);
    const Page = defineComponent({
      setup() {
        const page = useContent("docs", "intro");
        const hits = useContentSearch("docs", "");
        return () => h("p", `${page.loading.value}:${JSON.stringify(hits.data.value)}`);
      },
    });

    const html = await renderToString(createSSRApp(Page));

    expect(html).toBe("<p>true:[]</p>");
    expect(reads).toEqual([]);
    expect(searches).toEqual([]);
  });

  it("lets composables in the same setup read the handle provideGraft gave", async () => {
    const { graft } = controllable();
    const { graft: preview } = controllable();
    const { provideGraft, useGraft } = createGraftComposables(graft);
    let seen: unknown;
    const Page = defineComponent({
      setup() {
        provideGraft(preview);
        seen = useGraft();
        return () => h("p");
      },
    });

    await renderToString(createSSRApp(Page));

    expect(seen).toBe(preview);
  });
});

describe("useGraft", () => {
  it("reads the handle an app provides, and the factory's own outside any component", () => {
    const { graft } = controllable();
    const { graft: preview } = controllable();
    const { useGraft, graftPlugin } = createGraftComposables(graft);
    const app = createApp({}).use(graftPlugin(preview));

    expect(app.runWithContext(() => useGraft())).toBe(preview);
    expect(useGraft()).toBe(graft);
  });
});

describe("types", () => {
  it("keeps the exact document type through every composable", () => {
    const { graft } = controllable();
    const composables = createGraftComposables(graft);
    expectTypeOf(composables.useContent<"docs">).returns.toEqualTypeOf<
      ReadState<Document<typeof docs> | null>
    >();
    expectTypeOf(composables.useContentSearch<"docs">).returns.toEqualTypeOf<
      ReadState<SearchHit<typeof docs>[]>
    >();
    // Unknown collection names are compile errors, not runtime surprises.
    expectTypeOf(composables.useContent).parameter(0).toEqualTypeOf<"docs">();
  });
});
