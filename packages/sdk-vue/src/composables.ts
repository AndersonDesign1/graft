/**
 * Vue composables over the read handle: one per read, each reporting its
 * state as refs.
 *
 * Arguments can be plain values, refs or getters, so a read follows the state
 * it depends on. `useContent("pages", () => route.params.slug)` reads again
 * when the route changes, and `useContentSearch("posts", query)` reads again
 * as the reader types.
 *
 * Deliberately not a cache, for the same reason as @usegraft/sdk-react's
 * hooks: every re-read reports exactly one answer for the current arguments,
 * and caching, retries and deduplication belong to the app's own data layer.
 * In Nuxt that is `useAsyncData`, which composes with `graft.getContent`
 * directly and is what puts the data into the server-rendered HTML.
 *
 * The composables come out of a factory so they stay typed. A composable
 * reading an untyped injection could only promise `Document<AnyCollection>`,
 * so `data.value.data.title` would be `unknown` and an unknown collection name
 * a runtime surprise instead of a compile error.
 */
import {
  getCurrentInstance,
  hasInjectionContext,
  inject,
  onMounted,
  onScopeDispose,
  provide,
  shallowRef,
  toValue,
  watch,
  type App,
  type ComponentInternalInstance,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Plugin,
  type ShallowRef,
} from "vue";
import type {
  AnyCollection,
  Document,
  ListOptions,
  ReadOptions,
  SearchHit,
  SearchOptions,
} from "@usegraft/sdk-core";
import type { Graft } from "./graft";

/** What a composable reports about the read it is running. */
export interface ReadState<TData> {
  /** The answer for the current arguments, or undefined until one arrives. */
  data: Readonly<ShallowRef<TData | undefined>>;
  /** Why the read failed, usually a GraftError. */
  error: Readonly<ShallowRef<Error | undefined>>;
  /** True while a read is in flight, the first one included. */
  loading: Readonly<ShallowRef<boolean>>;
  /** Run the read again with the current arguments. */
  refresh: () => void;
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Run `read` now and whenever `source` changes, reporting the latest answer.
 *
 * `settle` returns an answer known without asking (a blank search), or
 * undefined to read. An answer that arrives after the arguments changed, after
 * `refresh`, or after the owning component is gone is dropped: with no cache
 * there is nothing it could be reconciled against, so the whole race story is
 * one counter.
 */
function useRead<TArgs, TData>(
  source: () => TArgs,
  read: (args: TArgs) => Promise<TData>,
  settle?: (args: TArgs) => TData | undefined,
): ReadState<TData> {
  const data = shallowRef<TData>();
  const error = shallowRef<Error>();
  const loading = shallowRef(true);
  let current = 0;
  let disposed = false;

  function run(args: TArgs): void {
    // A `refresh` kept after the component is gone must not start a read
    // whose answer would land in refs nothing renders.
    if (disposed) return;
    const ticket = ++current;
    const known = settle?.(args);
    if (known !== undefined) {
      data.value = known;
      error.value = undefined;
      loading.value = false;
      return;
    }
    // The previous answer belongs to the previous arguments. Clear it in the
    // same tick, so no render shows old hits under a new query.
    data.value = undefined;
    error.value = undefined;
    loading.value = true;
    read(args).then(
      (answer) => {
        if (ticket !== current) return;
        data.value = answer;
        loading.value = false;
      },
      (cause: unknown) => {
        if (ticket !== current) return;
        error.value = asError(cause);
        loading.value = false;
      },
    );
  }

  if (getCurrentInstance()) {
    // In a component, read once it is mounted. Setup also runs during server
    // rendering, where an answer could never reach the HTML, so reading there
    // only sent requests whose results were thrown away. An answer known
    // without asking (a blank search) is still given at once, on both sides.
    const known = settle?.(source());
    if (known !== undefined) {
      data.value = known;
      loading.value = false;
    }
    onMounted(() => {
      watch(source, run, { immediate: true });
    });
  } else {
    // Outside a component (a store, a test's effect scope) there is no mount.
    watch(source, run, { immediate: true });
  }
  onScopeDispose(() => {
    disposed = true;
    current += 1;
  }, true);

  return { data, error, loading, refresh: () => run(source()) };
}

export interface GraftComposables<TCollections extends Record<string, AnyCollection>> {
  /**
   * Point the composables in this component and its children at another
   * handle: a preview branch's endpoint, or a fake in tests. Call it in
   * `setup`, before the composables that should read it. Without it they read
   * the handle the factory was built with.
   */
  provideGraft: (graft: Graft<TCollections>) => void;
  /** The same, for a whole app: `app.use(graftPlugin(previewGraft))`. */
  graftPlugin: (graft: Graft<TCollections>) => Plugin;
  /** The handle in scope, for reads the composables don't cover. */
  useGraft: () => Graft<TCollections>;
  /** One document, or null when the collection has no such slug. */
  useContent: <K extends keyof TCollections & string>(
    collection: K,
    slug: MaybeRefOrGetter<string>,
    options?: MaybeRefOrGetter<ReadOptions | undefined>,
  ) => ReadState<Document<TCollections[K]> | null>;
  /** A collection, in index order. */
  useContentList: <K extends keyof TCollections & string>(
    collection: K,
    options?: MaybeRefOrGetter<ListOptions | undefined>,
  ) => ReadState<Document<TCollections[K]>[]>;
  /**
   * Full-text search within one collection, best-ranked first. A blank query
   * reports no hits and sends no request.
   */
  useContentSearch: <K extends keyof TCollections & string>(
    collection: K,
    query: MaybeRefOrGetter<string>,
    options?: MaybeRefOrGetter<SearchOptions | undefined>,
  ) => ReadState<SearchHit<TCollections[K]>[]>;
}

/**
 * Bind the composables to one handle, and to the collections it was built
 * with.
 *
 * ```ts
 * // src/graft.ts
 * import { createGraft, createGraftComposables } from "@usegraft/sdk-vue";
 * import { collections } from "../graft.config";
 *
 * export const graft = createGraft({ endpoint: "/api/content/v1", collections });
 * export const { useContent, useContentList, useContentSearch } = createGraftComposables(graft);
 * ```
 */
export function createGraftComposables<TCollections extends Record<string, AnyCollection>>(
  graft: Graft<TCollections>,
): GraftComposables<TCollections> {
  // One key per factory, so two handles typed for different collections can
  // never be confused through injection.
  const key: InjectionKey<Graft<TCollections>> = Symbol("graft");

  // Outside a component (a store, a plain module) there is nothing to inject
  // from, and the factory's own handle is the answer.
  // `inject` reads what a component's parents provided, never its own, so a
  // component that calls provideGraft and then a composable would read the
  // factory's handle. The handle a component provides for itself is kept here.
  const ownGraft = new WeakMap<ComponentInternalInstance, Graft<TCollections>>();

  const useGraft = (): Graft<TCollections> => {
    const instance = getCurrentInstance();
    const own = instance ? ownGraft.get(instance) : undefined;
    if (own) return own;
    return hasInjectionContext() ? inject(key, graft) : graft;
  };

  return {
    provideGraft: (value) => {
      provide(key, value);
      const instance = getCurrentInstance();
      if (instance) ownGraft.set(instance, value);
    },
    graftPlugin: (value) => ({
      install(app: App) {
        app.provide(key, value);
      },
    }),
    useGraft,

    useContent(collection, slug, options) {
      const handle = useGraft();
      return useRead(
        () => ({ slug: toValue(slug), branch: toValue(options)?.branch }),
        ({ slug: value, branch }) => handle.getContent(collection, value, { branch }),
      );
    },

    useContentList(collection, options) {
      const handle = useGraft();
      return useRead(
        () => {
          const opts = toValue(options);
          return { branch: opts?.branch, limit: opts?.limit, offset: opts?.offset };
        },
        (args) => handle.listContent(collection, args),
      );
    },

    useContentSearch(collection, query, options) {
      const handle = useGraft();
      return useRead(
        () => {
          const opts = toValue(options);
          return { query: toValue(query), branch: opts?.branch, limit: opts?.limit };
        },
        ({ query: text, branch, limit }) =>
          handle.searchContent(collection, text, { branch, limit }),
        // A search box starts blank, and the content API refuses a blank
        // query. Nothing matches nothing, so answer without a read. A `branch`
        // still goes through the handle, which refuses one it cannot serve,
        // so a bad option is not hidden until someone types.
        ({ query: text, branch }) => (text.trim() === "" && branch === undefined ? [] : undefined),
      );
    },
  };
}
