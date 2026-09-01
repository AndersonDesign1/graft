import {
  ErrorCodes,
  GraftError,
  rateIdentity,
  type ContentIndexReader,
  type ContentRow,
  type ContentSearchHit,
  type ErrorCode,
  type GraftErrorJSON,
  type ReaderReadOptions,
  type ReaderSearchOptions,
} from "@usegraft/contracts";

const CONTENT_API_BASE = "/api/content/v1";
const MAX_QUERY_LIMIT = 500;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

type ContentApiHandler = (request: Request) => Promise<Response>;

interface WireContentRow {
  branchId: string;
  collection: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
  contentHash: string;
  sourcePath: string;
  deleted: boolean;
  updatedAt: string;
  search: string | null;
}

interface WireContentSearchHit {
  row: WireContentRow;
  rank: number;
  snippet: string;
}

export interface ContentApiRateLimit {
  /** Requests allowed per identity per window. */
  limit: number;
  /** Window length in seconds. Also the `Retry-After` value on a refusal. */
  windowSeconds: number;
}

export interface ContentApiHandlerOptions {
  /** Collection names this endpoint may expose. */
  collections: readonly string[];
  /** The one branch represented by this endpoint. Callers cannot override it. */
  branch: string;
  /** Reader owned by the caller. The handler never closes it. */
  index: ContentIndexReader;
  /**
   * Per-identity backstop. Omitted means unlimited, which is the right default
   * for a handler mounted behind something that already has a limiter — but a
   * mount facing the open internet wants one, because these routes run database
   * listings and full-text searches for callers this handler never
   * authenticates.
   */
  rateLimit?: ContentApiRateLimit;
  /**
   * How many proxies in front of this handler are ours. Forwarded to
   * `rateIdentity`; zero (the default) means `x-forwarded-for` is never read
   * and every unidentified caller shares one bucket.
   */
  trustedProxyHops?: number;
  /**
   * Origins allowed to read responses from a browser.
   *
   * Omitted means no CORS headers at all, which is same-origin only — the
   * correct default, because publishing an endpoint to other origins is a
   * decision for whoever deploys it and not one a library should make on their
   * behalf. `@usegraft/sdk-react` needs this set whenever the app and the
   * content API are on different origins, which is the ordinary case.
   *
   * An explicit list is echoed back per request (with `Vary: Origin`, so a
   * cache cannot serve one origin's response to another). `"*"` allows any
   * origin and is reasonable for content that is public anyway — which this
   * handler's content is, since it authenticates nobody.
   */
  allowedOrigins?: readonly string[] | "*";
}

export interface ContentApiReaderOptions {
  /**
   * API base URL: absolute (https://cms.example.com/api/content/v1), or a
   * same-origin path (/api/content/v1) when running in a browser, where it
   * resolves against the page origin.
   */
  endpoint: string | URL;
  /** Fetch implementation for non-browser runtimes, tests, or instrumentation. */
  fetch?: typeof globalThis.fetch;
  /** Static headers sent with every request, such as Authorization. */
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ErrorCodes, value);
}

function parseGraftError(value: unknown): GraftError | undefined {
  if (!isRecord(value) || !isErrorCode(value.error) || typeof value.message !== "string") {
    return undefined;
  }
  if (value.fix !== undefined && typeof value.fix !== "string") return undefined;
  if (value.details !== undefined && !isRecord(value.details)) return undefined;

  const json: GraftErrorJSON = {
    error: value.error,
    message: value.message,
  };
  if (typeof value.fix === "string") json.fix = value.fix;
  if (isRecord(value.details)) json.details = value.details;
  return new GraftError({
    code: json.error,
    message: json.message,
    fix: json.fix,
    details: json.details,
  });
}

function protocolError(message: string, details?: Record<string, unknown>): GraftError {
  return new GraftError({
    code: "FUNCTION_EXECUTION_FAILED",
    message,
    fix: "Check that endpoint points to a compatible /api/content/v1 server and that no proxy is replacing its JSON response.",
    details,
  });
}

function stringField(value: Record<string, unknown>, field: string, location: string): string {
  const raw = value[field];
  if (typeof raw !== "string") {
    throw protocolError(`Content API returned a malformed row at ${location}.`, {
      location,
      field,
    });
  }
  return raw;
}

function parseWireRow(value: unknown, location: string): ContentRow {
  if (!isRecord(value)) {
    throw protocolError(`Content API returned a malformed row at ${location}.`, { location });
  }

  const data = value.data;
  if (!isRecord(data)) {
    throw protocolError(`Content API returned a malformed row at ${location}.`, {
      location,
      field: "data",
    });
  }
  if (typeof value.deleted !== "boolean") {
    throw protocolError(`Content API returned a malformed row at ${location}.`, {
      location,
      field: "deleted",
    });
  }
  const search = value.search;
  if (search !== null && typeof search !== "string") {
    throw protocolError(`Content API returned a malformed row at ${location}.`, {
      location,
      field: "search",
    });
  }
  const updatedAtRaw = stringField(value, "updatedAt", location);
  const updatedAt = new Date(updatedAtRaw);
  if (Number.isNaN(updatedAt.getTime())) {
    throw protocolError(`Content API returned an invalid updatedAt at ${location}.`, {
      location,
      updatedAt: updatedAtRaw,
    });
  }

  return {
    branchId: stringField(value, "branchId", location),
    collection: stringField(value, "collection", location),
    slug: stringField(value, "slug", location),
    data,
    body: stringField(value, "body", location),
    contentHash: stringField(value, "contentHash", location),
    sourcePath: stringField(value, "sourcePath", location),
    deleted: value.deleted,
    updatedAt,
    search,
  };
}

function parseRowsPayload(value: unknown): ContentRow[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw protocolError('Content API documents response must be an object with a "rows" array.');
  }
  return value.rows.map((row, index) => parseWireRow(row, `rows[${index}]`));
}

function parseHitsPayload(value: unknown): ContentSearchHit[] {
  if (!isRecord(value) || !Array.isArray(value.hits)) {
    throw protocolError('Content API search response must be an object with a "hits" array.');
  }
  return value.hits.map((value, index) => {
    const location = `hits[${index}]`;
    if (
      !isRecord(value) ||
      typeof value.rank !== "number" ||
      !Number.isFinite(value.rank) ||
      typeof value.snippet !== "string"
    ) {
      throw protocolError(`Content API returned a malformed search hit at ${location}.`, {
        location,
      });
    }
    return {
      row: parseWireRow(value.row, `${location}.row`),
      rank: value.rank,
      snippet: value.snippet,
    };
  });
}

function toWireRow(row: ContentRow): WireContentRow {
  return {
    branchId: row.branchId,
    collection: row.collection,
    slug: row.slug,
    data: row.data,
    body: row.body,
    contentHash: row.contentHash,
    sourcePath: row.sourcePath,
    deleted: row.deleted,
    updatedAt: row.updatedAt.toISOString(),
    search: row.search,
  };
}

function json(value: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers = new Headers();
  if (extra) {
    for (const [name, headerValue] of Object.entries(extra)) {
      headers.set(name, headerValue);
    }
  }
  headers.set("content-type", JSON_CONTENT_TYPE);
  return new Response(JSON.stringify(value), { status, headers });
}

/**
 * Headers a refusal carries beyond the body. `Allow` tells a wrong-method
 * caller what the route accepts; `Retry-After` tells a throttled one when to
 * come back, which is the difference between a client that backs off and one
 * that spins.
 */
function responseHeadersFor(error: GraftError): Record<string, string> | undefined {
  if (error.code === "METHOD_NOT_ALLOWED") return { allow: "GET" };
  if (error.code === "RATE_LIMITED") {
    const retryAfter = error.details?.retryAfter;
    if (typeof retryAfter === "number") return { "retry-after": String(retryAfter) };
  }
  return undefined;
}

function statusFor(error: GraftError): number {
  switch (error.code) {
    case "COLLECTION_NOT_FOUND":
    case "ROUTE_NOT_FOUND":
      return 404;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "INPUT_VALIDATION_FAILED":
      return 400;
    case "RATE_LIMITED":
      return 429;
    default:
      return 500;
  }
}

function inputError(message: string, fix: string, details?: Record<string, unknown>): GraftError {
  return new GraftError({ code: "INPUT_VALIDATION_FAILED", message, fix, details });
}

function parseLimit(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw inputError(
      `"${raw}" is not a valid limit.`,
      `Pass limit as a positive integer. Values above ${MAX_QUERY_LIMIT} are capped at ${MAX_QUERY_LIMIT}.`,
      { limit: raw },
    );
  }
  return Math.min(value, MAX_QUERY_LIMIT);
}

function parseOffset(url: URL): number | undefined {
  const raw = url.searchParams.get("offset");
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw inputError(`"${raw}" is not a valid offset.`, "Pass offset as a non-negative integer.", {
      offset: raw,
    });
  }
  return value;
}

function requiredParam(url: URL, name: "collection" | "query"): string {
  const value = url.searchParams.get(name)?.trim() ?? "";
  if (value === "") {
    throw inputError(
      `${name} query param is required.`,
      `GET ${CONTENT_API_BASE}/${name === "query" ? "search" : "documents"}?collection=<name>${name === "query" ? "&query=<text>" : ""}`,
      { parameter: name },
    );
  }
  return value;
}

function assertNoBranchOverride(url: URL): void {
  if (url.searchParams.has("branch")) {
    throw inputError(
      "The content API does not accept a branch query param.",
      "Use the endpoint mounted for the branch you need. Each endpoint represents exactly one branch.",
      { branch: url.searchParams.get("branch") },
    );
  }
}

/** Create the read-only Web-standard handler mounted at /api/content/v1. */
/**
 * A fixed-window counter per caller identity, held in memory.
 *
 * Deliberately not the audit-table counter `createFunctionsHandler` uses. That
 * one counts rows it is already writing; these routes are reads that write
 * nothing, and adding a write per read to enforce a read limit inverts the cost
 * of the thing being protected.
 *
 * Two honest limits follow from that. It is per process, so N replicas allow
 * N times the limit; and it resets on restart. Both are acceptable for a
 * backstop whose job is to stop one caller trivially exhausting the database —
 * a deployment that needs an exact global limit puts it in the proxy that is
 * already terminating TLS.
 *
 * The map is bounded by the distinct identities seen inside one window, which
 * is bounded by real traffic rather than by anything a caller controls: with
 * `trustedProxyHops` at its default, `rateIdentity` never reads
 * `x-forwarded-for`, so an attacker cannot mint identities to grow it. The
 * sweep keeps that true across windows.
 */
function createRateLimiter(
  limit: number,
  windowSeconds: number,
): (identity: string, now: number) => number | undefined {
  const windowMs = windowSeconds * 1000;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  // Sweeping every request would make each read O(identities). Sweeping only
  // once the map is larger than a busy window plausibly needs keeps the common
  // path O(1) and still collects everything expired.
  const SWEEP_THRESHOLD = 4096;

  return (identity, now) => {
    if (buckets.size >= SWEEP_THRESHOLD) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const bucket = buckets.get(identity);
    if (bucket === undefined || bucket.resetAt <= now) {
      buckets.set(identity, { count: 1, resetAt: now + windowMs });
      return undefined;
    }

    bucket.count += 1;
    if (bucket.count <= limit) return undefined;
    // Ceil so the caller never retries a millisecond early and is refused again.
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  };
}

/**
 * The CORS headers for one request, or nothing when the origin is not allowed.
 *
 * Returning nothing rather than a rejection is deliberate: a disallowed origin
 * gets a perfectly ordinary response that the *browser* then refuses to expose
 * to the page. That is how CORS is specified to work, and answering differently
 * would turn the allowlist into an origin oracle for non-browser callers, who
 * are not bound by it anyway.
 */
function corsHeaders(
  request: Request,
  allowed: readonly string[] | "*" | undefined,
): Record<string, string> | undefined {
  if (allowed === undefined) return undefined;
  const origin = request.headers.get("origin");
  if (origin === null) return undefined;

  if (allowed === "*") {
    return { "access-control-allow-origin": "*" };
  }
  if (!allowed.includes(origin)) return undefined;
  // Vary is not optional here. Without it a shared cache can hand one origin
  // the response it stored for another, and the allowlist stops meaning
  // anything.
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

export function createContentApiHandler(options: ContentApiHandlerOptions): ContentApiHandler {
  const collections = new Set(options.collections);
  const consume =
    options.rateLimit === undefined
      ? undefined
      : createRateLimiter(options.rateLimit.limit, options.rateLimit.windowSeconds);
  const trustedProxyHops = options.trustedProxyHops ?? 0;

  return async (request): Promise<Response> => {
    const url = new URL(request.url);
    const cors = corsHeaders(request, options.allowedOrigins);

    // Preflight is answered before method validation and before the rate
    // limiter: it is the browser asking permission, not the caller reading
    // anything, so a 405 or a charged bucket would both be wrong.
    if (request.method === "OPTIONS" && cors !== undefined) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers":
            request.headers.get("access-control-request-headers") ?? "authorization,content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    try {
      const route =
        url.pathname === `${CONTENT_API_BASE}/documents`
          ? "documents"
          : url.pathname === `${CONTENT_API_BASE}/search`
            ? "search"
            : undefined;
      if (route === undefined) {
        throw new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: `Nothing is mounted at ${url.pathname}.`,
          fix: `Use GET ${CONTENT_API_BASE}/documents or GET ${CONTENT_API_BASE}/search.`,
          details: { pathname: url.pathname },
        });
      }
      if (request.method !== "GET") {
        throw new GraftError({
          code: "METHOD_NOT_ALLOWED",
          message: `Content API reads use GET, not ${request.method}.`,
          fix: `Send a GET request to ${url.pathname}.`,
          details: { method: request.method },
        });
      }

      if (consume !== undefined && options.rateLimit !== undefined) {
        const retryAfter = consume(rateIdentity(request, trustedProxyHops), Date.now());
        if (retryAfter !== undefined) {
          throw new GraftError({
            code: "RATE_LIMITED",
            message: `This content endpoint allows ${options.rateLimit.limit} requests per ${options.rateLimit.windowSeconds}s per caller.`,
            fix: `Wait ${retryAfter}s — the Retry-After header says how long — then retry. Cache reads at your CDN if you need a higher sustained rate.`,
            details: {
              limit: options.rateLimit.limit,
              windowSeconds: options.rateLimit.windowSeconds,
              retryAfter,
            },
          });
        }
      }

      assertNoBranchOverride(url);
      const collection = requiredParam(url, "collection");
      if (!collections.has(collection)) {
        throw new GraftError({
          code: "COLLECTION_NOT_FOUND",
          message: `Collection "${collection}" is not registered on this content endpoint.`,
          fix: `Use one of the registered collections: ${[...collections].join(", ") || "(none)"}.`,
          details: { collection, registered: [...collections] },
        });
      }

      const limit = parseLimit(url);
      if (route === "documents") {
        const slugRaw = url.searchParams.get("slug");
        const slug = slugRaw === null ? undefined : slugRaw.trim();
        if (slug === "") {
          throw inputError(
            "slug cannot be empty when provided.",
            "Omit slug to list the collection, or pass a non-empty document slug.",
            { slug: slugRaw },
          );
        }
        const rows = await options.index.readContent({
          collection,
          slug,
          limit,
          offset: parseOffset(url),
          branch: options.branch,
        });
        return json({ rows: rows.map(toWireRow) }, 200, cors);
      }

      const query = requiredParam(url, "query");
      const hits = await options.index.searchContent({
        collections: [collection],
        query,
        limit,
        branch: options.branch,
      });
      return json(
        {
          hits: hits.map(
            ({ row, rank, snippet }): WireContentSearchHit => ({
              row: toWireRow(row),
              rank,
              snippet,
            }),
          ),
        },
        200,
        cors,
      );
    } catch (error) {
      const graftError =
        error instanceof GraftError
          ? error
          : protocolError(
              `Content API failed to read its index: ${error instanceof Error ? error.message : String(error)}`,
            );
      // Errors carry them too: without the header the browser hides the body,
      // and a caller debugging a 400 sees an opaque network failure instead of
      // the `fix` this API went to the trouble of sending.
      const extra = { ...responseHeadersFor(graftError), ...cors };
      return json(
        graftError.toJSON(),
        statusFor(graftError),
        Object.keys(extra).length > 0 ? extra : undefined,
      );
    }
  };
}

function normalizeEndpoint(endpoint: string | URL): URL {
  // A same-origin path is the ordinary way to name this endpoint from a
  // browser, and it is what /docs/reading-content tells people to write. Bare
  // `new URL("/api/content/v1")` throws TypeError, so resolve it against the
  // page origin first. Outside a browser there is no origin to resolve
  // against, and guessing one would send content reads somewhere arbitrary —
  // so that case is refused with the reason rather than a TypeError.
  const url = endpoint instanceof URL ? new URL(endpoint) : resolveEndpointUrl(endpoint);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function resolveEndpointUrl(endpoint: string): URL {
  // Narrowed rather than relying on the DOM lib, which this package does not
  // pull in: it runs on the server too.
  // SAFETY: widening-only. `location` is declared optional and read with `?.`,
  // so a runtime without it yields undefined rather than throwing, which is the
  // non-browser branch below.
  const base = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return base === undefined ? new URL(endpoint) : new URL(endpoint, base);
  } catch {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `\`endpoint\` is not a valid URL: ${endpoint}`,
      fix:
        base === undefined
          ? "Outside a browser there is no page origin to resolve a relative path against. Pass an absolute endpoint, e.g. https://cms.example.com/api/content/v1."
          : "Pass an absolute endpoint (https://cms.example.com/api/content/v1) or a same-origin path (/api/content/v1).",
      details: { endpoint, base },
    });
  }
}

/** Create a ContentIndexReader that reads a remote /api/content/v1 endpoint. */
export function createContentApiReader(options: ContentApiReaderOptions): ContentIndexReader {
  const endpoint = normalizeEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const headers = new Headers();
  if (options.headers) {
    for (const [name, headerValue] of Object.entries(options.headers)) {
      headers.set(name, headerValue);
    }
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");

  const getJson = async (
    route: string,
    params: URLSearchParams,
  ): Promise<Record<string, unknown>> => {
    const url = new URL(endpoint);
    url.pathname = `${endpoint.pathname}/${route}`;
    url.search = params.toString();

    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", headers });
    } catch (error) {
      throw protocolError(
        `Content API request to ${url.toString()} failed: ${error instanceof Error ? error.message : String(error)}`,
        { endpoint: url.toString() },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw protocolError(`Content API returned non-JSON HTTP ${response.status}.`, {
        endpoint: url.toString(),
        status: response.status,
      });
    }

    if (!response.ok) {
      const remoteError = parseGraftError(payload);
      if (remoteError) throw remoteError;
      throw protocolError(`Content API returned HTTP ${response.status} without a GraftError.`, {
        endpoint: url.toString(),
        status: response.status,
      });
    }
    if (!isRecord(payload)) {
      throw protocolError("Content API returned JSON that was not an object.", {
        endpoint: url.toString(),
      });
    }
    return payload;
  };

  return {
    async readContent(options: ReaderReadOptions): Promise<ContentRow[]> {
      const params = new URLSearchParams({ collection: options.collection });
      if (options.slug !== undefined) params.set("slug", options.slug);
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.offset !== undefined) params.set("offset", String(options.offset));
      return parseRowsPayload(await getJson("documents", params));
    },

    async searchContent(options: ReaderSearchOptions): Promise<ContentSearchHit[]> {
      if (options.collections?.length !== 1) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "The content API reader needs exactly one collection for search.",
          fix: "Pass collections: [name]. Graft SDK searchDocuments already does this.",
          details: { collections: options.collections },
        });
      }
      const params = new URLSearchParams({
        collection: options.collections[0],
        query: options.query,
      });
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      return parseHitsPayload(await getJson("search", params));
    },

    // The reader owns no server or database handle.
    async close() {},
  };
}
