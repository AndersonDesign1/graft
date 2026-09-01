/**
 * The browser read handle — the same `getContent` / `listContent` /
 * `searchContent` surface every server adapter has, reading over HTTP instead
 * of over a database connection.
 *
 * Types do not cross the wire. The app imports its own `collections` from
 * `graft.config.ts` at compile time, exactly as a server adapter does, and
 * `@usegraft/content-api`'s reader supplies the runtime data. So the schema
 * still types every read with no codegen and no generated client, and the wire
 * carries documents rather than type information.
 *
 * There is no `db` option here, and that absence is the point: a Postgres
 * handle in a browser bundle is a database URL in a browser bundle. What this
 * package reads is a `graft serve` (or any other mount of
 * `createContentApiHandler`), which is already scoped to one branch and one set
 * of collections on the server side.
 */
import { createContentApiReader } from "@usegraft/content-api";
import { GraftError } from "@usegraft/contracts";
import {
  createClient,
  type AnyCollection,
  type ClientOptions,
  type Document,
  type GraftClient,
  type ListOptions,
  type ReadOptions,
  type SearchHit,
  type SearchOptions,
} from "@usegraft/sdk-core";

export interface GraftOptions<TCollections extends Record<string, AnyCollection>> extends Omit<
  ClientOptions<TCollections>,
  "index"
> {
  /**
   * Your own reader, when `endpoint` is not enough. Optional here because
   * `endpoint` is the ordinary way to configure this package, and exactly one
   * of the two is required.
   */
  index?: ClientOptions<TCollections>["index"];
  /** Content API base URL, e.g. `https://cms.example.com/api/content/v1`. */
  endpoint?: string | URL;
  /** Static headers sent with every read, such as `Authorization`. */
  headers?: Record<string, string>;
  /** Fetch implementation, for tests, instrumentation, or a non-browser runtime. */
  fetch?: typeof globalThis.fetch;
}

export interface Graft<TCollections extends Record<string, AnyCollection>> {
  /** Typed getDocument. */
  getContent<K extends keyof TCollections & string>(
    collection: K,
    slug: string,
    options?: ReadOptions,
  ): Promise<Document<TCollections[K]> | null>;
  /** Typed listDocuments. */
  listContent<K extends keyof TCollections & string>(
    collection: K,
    options?: ListOptions,
  ): Promise<Document<TCollections[K]>[]>;
  /** Typed searchDocuments (full-text, best-ranked first). */
  searchContent<K extends keyof TCollections & string>(
    collection: K,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchHit<TCollections[K]>[]>;
  /** The underlying sdk-core client, for anything the helpers don't cover. */
  client: GraftClient<TCollections>;
}

function readerFor<TCollections extends Record<string, AnyCollection>>(
  options: GraftOptions<TCollections>,
): ClientOptions<TCollections>["index"] {
  if (options.endpoint === undefined) {
    if (options.index === undefined) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: "createGraft needs somewhere to read from: pass `endpoint` or `index`.",
        fix: "Pass `endpoint` (the content API a `graft serve` mounts, e.g. https://cms.example.com/api/content/v1) or `index` (your own ContentIndexReader). There is no `db` option in the browser.",
      });
    }
    return options.index;
  }

  // A content API endpoint *is* a branch: the server pins one and refuses a
  // branch query param, so a `branch` set here would be dropped on the way out
  // and the caller would read main while believing they read a preview.
  if (options.branch !== undefined) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "`branch` cannot be combined with `endpoint`.",
      fix: "Each content API endpoint serves exactly one branch, fixed by the server. Point `endpoint` at the branch's own deployment instead of asking for one here.",
      details: { branch: options.branch, endpoint: options.endpoint.toString() },
    });
  }

  return createContentApiReader({
    endpoint: options.endpoint,
    headers: options.headers,
    fetch: options.fetch,
  });
}

/**
 * Build the read handle. Give it your `collections` and the endpoint your
 * content API is mounted at; reads are typed from the schema, not from the
 * response.
 */
export function createGraft<TCollections extends Record<string, AnyCollection>>(
  options: GraftOptions<TCollections>,
): Graft<TCollections> {
  const client = createClient({
    index: readerFor(options),
    collections: options.collections,
    branch: options.branch,
  });

  // An endpoint is one branch, pinned by the server, and the server refuses a
  // branch query param outright. So a per-read `branch` is not merely
  // unsupported here — it is dropped on the way out, and the caller reads main
  // while believing they read a preview. The constructor already refuses
  // `branch` beside `endpoint`; this closes the same hole one level down, where
  // it is easier to reach and just as silent.
  const endpointPinned = options.endpoint !== undefined;
  function assertNoBranch(opts: ReadOptions | undefined): void {
    if (!endpointPinned || opts?.branch === undefined) return;
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "`branch` cannot be passed to a read on an endpoint-backed handle.",
      fix: "Each content API endpoint serves exactly one branch, fixed by the server, and the branch query param is refused. Point a second handle at the preview's own endpoint instead of asking this one for a branch.",
      details: { branch: opts.branch, endpoint: String(options.endpoint) },
    });
  }

  // `async` so the refusal arrives as a rejection. These are declared to return
  // promises, and a synchronous throw from one is the kind of thing a caller
  // handling errors with `.catch()` never sees.
  return {
    client,
    async getContent(collection, slug, opts) {
      assertNoBranch(opts);
      return client.getDocument(collection, slug, opts);
    },
    async listContent(collection, opts) {
      assertNoBranch(opts);
      return client.listDocuments(collection, opts);
    },
    async searchContent(collection, query, opts) {
      assertNoBranch(opts);
      return client.searchDocuments(collection, query, opts);
    },
  };
}
