/**
 * React ergonomics over the read handle: a provider and three hooks that run
 * the async reads and report their state.
 *
 * Deliberately not a cache. Every re-read starts from nothing and reports
 * exactly one answer for the current arguments, because an SDK that invented
 * its own stale-while-revalidate would be a worse copy of the query client the
 * app already has. Wrap `graft.getContent` in TanStack Query or SWR when you
 * want caching, retries, deduplication or background refresh — the handle is a
 * plain async function and composes with either of them.
 *
 * Browser-side. `useEffect` does not run during server rendering, so on the
 * server these hooks render their loading state and nothing else. The one
 * exception is a blank search, which is answered without a read, so it renders
 * its empty result on the server too. Data that
 * has to be in the HTML belongs in a loader or a server adapter
 * (@usegraft/sdk-react-router, @usegraft/sdk-tanstack-start, and the rest).
 *
 * The hooks come out of a factory rather than being importable directly. That
 * is what keeps the no-codegen contract: a hook reading an untyped context
 * could only return `Document<AnyCollection>`, so `data.title` would be
 * `unknown` and an unknown collection name would be a runtime surprise instead
 * of a compile error. Binding the factory to your `collections` once is what
 * buys typed reads everywhere the hooks are used.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  AnyCollection,
  Document,
  ListOptions,
  ReadOptions,
  SearchHit,
  SearchOptions,
} from "@usegraft/sdk-core";
import type { Graft } from "./graft";

/** What a hook reports about the read it is running. */
export interface AsyncState<TData> {
  /** The answer for the current arguments, or undefined until one arrives. */
  data: TData | undefined;
  /** Why the read failed, usually a GraftError. */
  error: Error | undefined;
  /** True while a read is in flight, the first one included. */
  loading: boolean;
  /** Run the read again. */
  refresh: () => void;
}

type ReadState<TData> = Omit<AsyncState<TData>, "refresh">;

// One shared object, so every render that is still waiting reports the same
// value.
const PENDING: ReadState<never> = { data: undefined, error: undefined, loading: true };

// What a search for nothing reports. Shared for the same reason, and so `data`
// keeps its identity from one render to the next. Frozen because it is shared:
// a caller that pushed into one blank result would otherwise see the item in
// every other blank search.
const NO_HITS: ReadState<never[]> = {
  data: Object.freeze([]) as never[],
  error: undefined,
  loading: false,
};

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Run `read` and report its state, re-running whenever its identity changes.
 * Callers pass a `useCallback` keyed on the read's own arguments, which is what
 * makes "the arguments changed" and "run it again" the same mechanism.
 *
 * `settled` is an answer known without asking. While it is set, `read` does
 * not run and `settled` is what the hook reports. Passing it, rather than
 * skipping the call, is what keeps the hook unconditional.
 *
 * An answer is kept with the read and attempt it answers, and reported only
 * while those are still current. When the arguments change or `refresh` runs,
 * the same render reports loading. Resetting in the effect instead left one
 * render showing the previous arguments' result, for example old hits under a
 * new query.
 */
function useRead<TData>(read: () => Promise<TData>, settled?: ReadState<TData>): AsyncState<TData> {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    read: () => Promise<TData>;
    attempt: number;
    state: ReadState<TData>;
  }>();

  useEffect(() => {
    if (settled !== undefined) return;
    let live = true;
    read().then(
      (data) => {
        if (live) setAnswer({ read, attempt, state: { data, error: undefined, loading: false } });
      },
      (cause: unknown) => {
        if (live) {
          setAnswer({
            read,
            attempt,
            state: { data: undefined, error: asError(cause), loading: false },
          });
        }
      },
    );
    // A read that settles after the arguments changed, or after the component
    // is gone, is not the answer to anything that is still being asked. It is
    // dropped. With no cache there is nothing else it could be reconciled
    // against, which is why the whole race-condition story is this one flag.
    return () => {
      live = false;
    };
  }, [read, attempt, settled]);

  const refresh = useCallback(() => setAttempt((previous) => previous + 1), []);
  const current = answer?.read === read && answer.attempt === attempt ? answer.state : PENDING;
  return { ...(settled ?? current), refresh };
}

export interface GraftHooks<TCollections extends Record<string, AnyCollection>> {
  /**
   * Supplies the handle the hooks read. Optional — they fall back to the one
   * the factory was built with. Use it to point a subtree somewhere else: a
   * preview branch's endpoint, or a fake in tests.
   */
  GraftProvider: (props: { graft: Graft<TCollections>; children: ReactNode }) => ReactElement;
  /** The handle in scope, for reads the hooks don't cover. */
  useGraft: () => Graft<TCollections>;
  /** One document, or null when the collection has no such slug. */
  useContent: <K extends keyof TCollections & string>(
    collection: K,
    slug: string,
    options?: ReadOptions,
  ) => AsyncState<Document<TCollections[K]> | null>;
  /** A collection, in index order. */
  useContentList: <K extends keyof TCollections & string>(
    collection: K,
    options?: ListOptions,
  ) => AsyncState<Document<TCollections[K]>[]>;
  /**
   * Full-text search within one collection, best-ranked first. A blank query
   * reports no hits and sends no request.
   */
  useContentSearch: <K extends keyof TCollections & string>(
    collection: K,
    query: string,
    options?: SearchOptions,
  ) => AsyncState<SearchHit<TCollections[K]>[]>;
}

/**
 * Bind the provider and hooks to one handle, and to the collections that
 * handle was built with.
 *
 * ```ts
 * // src/graft.ts
 * import { createGraft, createGraftHooks } from "@usegraft/sdk-react";
 * import { collections } from "../graft.config";
 *
 * export const graft = createGraft({ endpoint: "/api/content/v1", collections });
 * export const { GraftProvider, useContent, useContentList, useContentSearch } =
 *   createGraftHooks(graft);
 * ```
 */
export function createGraftHooks<TCollections extends Record<string, AnyCollection>>(
  graft: Graft<TCollections>,
): GraftHooks<TCollections> {
  const GraftContext = createContext(graft);

  function GraftProvider({
    graft: value,
    children,
  }: {
    graft: Graft<TCollections>;
    children: ReactNode;
  }): ReactElement {
    return <GraftContext.Provider value={value}>{children}</GraftContext.Provider>;
  }

  const useGraft = (): Graft<TCollections> => useContext(GraftContext);

  return {
    GraftProvider,
    useGraft,

    useContent<K extends keyof TCollections & string>(
      collection: K,
      slug: string,
      options?: ReadOptions,
    ): AsyncState<Document<TCollections[K]> | null> {
      const handle = useGraft();
      // Keyed on the primitives rather than on `options`, which is a fresh
      // object on every render and would re-read forever.
      const branch = options?.branch;
      const read = useCallback(
        () => handle.getContent(collection, slug, { branch }),
        [handle, collection, slug, branch],
      );
      return useRead(read);
    },

    useContentList<K extends keyof TCollections & string>(
      collection: K,
      options?: ListOptions,
    ): AsyncState<Document<TCollections[K]>[]> {
      const handle = useGraft();
      const branch = options?.branch;
      const limit = options?.limit;
      const offset = options?.offset;
      const read = useCallback(
        () => handle.listContent(collection, { branch, limit, offset }),
        [handle, collection, branch, limit, offset],
      );
      return useRead(read);
    },

    useContentSearch<K extends keyof TCollections & string>(
      collection: K,
      query: string,
      options?: SearchOptions,
    ): AsyncState<SearchHit<TCollections[K]>[]> {
      const handle = useGraft();
      const branch = options?.branch;
      const limit = options?.limit;
      const read = useCallback(
        () => handle.searchContent(collection, query, { branch, limit }),
        [handle, collection, query, branch, limit],
      );
      // The content API refuses a blank query, and a search box starts blank.
      // Nothing matches nothing, so answer here instead of reporting an error
      // before the reader has typed anything. A `branch` still goes through the
      // handle, which answers a blank query with [] too but first refuses a
      // branch it cannot serve, so a bad option is not hidden until someone types.
      const settled = query.trim() === "" && branch === undefined ? NO_HITS : undefined;
      return useRead(read, settled);
    },
  };
}
