/**
 * Mounting the Graft runtime on a Nitro (h3) event handler.
 *
 * ```ts
 * // server/routes/api/mcp.post.ts (Nuxt) or routes/api/mcp.post.ts (Nitro)
 * import { createGraftMcpHandler } from "@usegraft/mcp";
 * import { graftHandler } from "@usegraft/sdk-nitro";
 * export default defineEventHandler(graftHandler(createGraftMcpHandler({ … })));
 * ```
 *
 * Two h3 majors are in use at once. Nuxt 4 runs nitropack 2 on h3 1, whose
 * event wraps a Node `IncomingMessage`. Nitro 3 and Nuxt 5 run h3 2, whose
 * `event.req` is already a Web `Request`. `graftHandler` takes either, typed
 * structurally, so this package depends on no h3, nitro or nitropack version
 * and there is no peer range to keep in step.
 *
 * Unlike the other adapters, this one owns the connection: Nitro hands it the
 * socket address. So it registers that address with `setRequestPeer`, and
 * anonymous callers get a rate-limit bucket each instead of sharing
 * "unknown". The address comes from the server, never from a header.
 */
import {
  bodyLimit,
  DEFAULT_MAX_MCP_BODY_BYTES,
  GraftError,
  payloadTooLarge,
  readBodyBytes,
  setRequestPeer,
} from "@usegraft/contracts";

export type FetchHandler = (request: Request) => Promise<Response>;

/** h3's key for a body it has already read and cached on the request. */
const H3_RAW_BODY: unique symbol = Symbol.for("h3RawBody");

/** A Node readable, as far as reading it to the end needs. */
export interface NodeReadable {
  pipe(...args: never[]): void;
  on(event: string, listener: (...args: never[]) => void): void;
}

/**
 * Every form a body already read upstream arrives in. h3's `readBody` caches
 * bytes, a string or a stream; nitropack's in-process fetch passes the body
 * the caller gave `$fetch`, which can be a parsed object.
 */
export type RawBody =
  | Uint8Array
  | string
  | URLSearchParams
  | ReadableStream<Uint8Array>
  | NodeReadable
  | { readonly [key: string]: unknown }
  | null
  | undefined;

/** The parts of a Node `IncomingMessage` the h3 1 path reads. */
export interface NodeIncoming {
  readonly method?: string;
  readonly url?: string;
  /** Set by connect-style routers that strip a mount prefix from `url`. */
  readonly originalUrl?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket?: { readonly remoteAddress?: string; readonly encrypted?: boolean } | null;
  /** A body something upstream already read. See `cachedBody`. */
  readonly [H3_RAW_BODY]?: RawBody | Promise<RawBody>;
  readonly rawBody?: RawBody;
  readonly body?: RawBody;
  on(event: string, listener: (...args: never[]) => void): void;
  /** Stop reading from the socket, once nobody wants the rest of the body. */
  pause?(): void;
  /** True once the whole body has arrived. */
  readonly complete?: boolean;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
}

/**
 * An event's context, read only for `clientAddress`. A record of unknown
 * values rather than `{ clientAddress?: string }`, so Nuxt's portable
 * `RequestEvent` (from `nuxt/server`), whose context is typed that way, is
 * accepted too. The address is checked to be a string before use.
 */
export type EventContext = { readonly [key: string]: unknown };

/** The Request h3 2 hands a handler: a Web `Request` plus what the server knew. */
export interface ServerRequest extends Request {
  /** The socket address, set by the server adapter (srvx). */
  readonly ip?: string;
  readonly context?: EventContext;
}

/**
 * Any h3 event, 1 or 2. Every field is optional because each major has a
 * different subset. `req` is the Web Request on h3 2, and on h3 1 a
 * deprecated alias for the Node request, so the code checks which.
 */
export interface NitroEvent {
  readonly req?: ServerRequest | NodeIncoming;
  readonly web?: { readonly request?: Request } | undefined;
  readonly node?: { readonly req: NodeIncoming } | undefined;
  readonly context?: EventContext | undefined;
}

export interface GraftHandlerOptions {
  /**
   * The most body bytes the h3 1 path reads before refusing with 413, in
   * bytes. Defaults to 32 MiB, the MCP handler's limit, so each Graft handler
   * still applies its own smaller limit as the bytes arrive. h3 2 and Web
   * runtimes hand over the platform's Request, which each handler reads under
   * its own limit.
   */
  maxBodyBytes?: number;
}

/** A Nitro event handler over a Graft handler. Works on h3 1 and h3 2. */
export function graftHandler(handler: FetchHandler, options: GraftHandlerOptions = {}) {
  const limit = bodyLimit(options.maxBodyBytes, DEFAULT_MAX_MCP_BODY_BYTES);
  return async (event: NitroEvent): Promise<Response> => {
    let request: Request;
    try {
      request = await toGraftRequest(event, { maxBodyBytes: limit });
    } catch (error) {
      if (error instanceof GraftError && error.code === "PAYLOAD_TOO_LARGE") {
        return Response.json(error.toJSON(), { status: 413, headers: { connection: "close" } });
      }
      throw error;
    }
    const response = await handler(request);
    // The handler answered without reading the whole body: it refused it as
    // too large, or never needed it. The rest is still on a paused socket, so
    // a kept-alive connection would never parse another request. Close it
    // after this response, as `graft serve` does.
    const nodeReq = event.req instanceof Request ? undefined : event.node?.req;
    if (nodeReq && nodeReq.complete === false && !response.headers.has("connection")) {
      const headers = new Headers(response.headers);
      headers.set("connection", "close");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  };
}

/**
 * The Web `Request` behind an h3 event, with its socket address registered as
 * the peer. Exported for apps that need the Request before deciding which
 * Graft handler to call.
 */
export async function toGraftRequest(
  event: NitroEvent,
  options: GraftHandlerOptions = {},
): Promise<Request> {
  // h3 2. Check this first: Nitro 3 also keeps a compatibility `event.node`.
  if (event.req instanceof Request) {
    const peer = clientAddress(event) ?? nonEmpty(event.req.ip);
    if (peer) setRequestPeer(event.req, peer);
    return event.req;
  }
  // h3 1 on a Web runtime (Cloudflare, Deno, Vercel Edge): the platform's own Request.
  const webRequest = event.web?.request;
  if (webRequest) {
    const peer = clientAddress(event);
    if (peer) setRequestPeer(webRequest, peer);
    return webRequest;
  }
  // h3 1 on Node.
  const nodeReq = event.node?.req;
  if (nodeReq) {
    const limit = bodyLimit(options.maxBodyBytes, DEFAULT_MAX_MCP_BODY_BYTES);
    const request = await fromNodeRequest(nodeReq, limit);
    const peer = clientAddress(event) ?? nodeReq.socket?.remoteAddress;
    if (peer) setRequestPeer(request, peer);
    return request;
  }
  throw new GraftError({
    code: "FRAMEWORK_VERSION_UNSUPPORTED",
    message:
      "graftHandler got an event with no Request on it: neither `event.req` (h3 2) nor `event.node.req` (h3 1).",
    fix: "Mount graftHandler on a Nitro or Nuxt event handler (h3 1.15 or newer, or h3 2). For any other server, call the Graft handler with a Web Request directly.",
  });
}

/** Methods h3 reads a body for. Matches h3 1's own list. */
const PAYLOAD_METHODS = new Set(["PATCH", "POST", "PUT", "DELETE"]);

/** `RequestInit` as Node's fetch takes it: a stream body needs `duplex`. */
type NodeRequestInit = RequestInit & { duplex?: "half" };

async function fromNodeRequest(req: NodeIncoming, limit: number): Promise<Request> {
  const method = (req.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const entry of value) headers.append(key, entry);
    else headers.set(key, value);
  }
  // The full path as the client sent it. A prefix router rewrites `url`.
  const path = req.originalUrl ?? req.url ?? "/";
  const protocol = req.socket?.encrypted ? "https" : "http";
  const url = requestUrl(protocol, headers.get("host"), path);
  const body = PAYLOAD_METHODS.has(method) ? await readBody(req, limit) : undefined;
  // They described the bytes on the wire. The body here may be re-encoded,
  // such as a parsed object serialized back to JSON, so they would be wrong.
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const init: NodeRequestInit = { method, headers };
  if (body instanceof ReadableStream) {
    init.body = body;
    init.duplex = "half";
  } else if (body && body.byteLength > 0) {
    init.body = body;
  }
  return new Request(url, init);
}

/**
 * The URL from the server's own origin plus the request target, joined as
 * text. Resolving the target against the origin instead would let a target
 * such as `//evil.test/x` replace the host the handler sees. A Host header
 * that is not a valid host falls back to `localhost`, the same as a missing
 * one, rather than failing the request.
 */
function requestUrl(protocol: string, host: string | null, path: string): URL {
  const target = path.startsWith("/") ? path : `/${path}`;
  try {
    return new URL(`${protocol}://${host ?? "localhost"}${target}`);
  } catch {
    return new URL(`${protocol}://localhost${target}`);
  }
}

/**
 * The request body as bytes, found the way h3 1's `readRawBody` finds it.
 *
 * The stream is not always where the body is. When Nuxt renders a page and
 * calls its own API route with `$fetch`, nitropack skips the network and
 * hands the route a stand-in request whose body sits on `req.body`, with a
 * stream that never emits it. And a middleware that read the body through
 * h3's `readBody` leaves it cached on the request. Reading only the stream
 * would turn both into an empty body.
 */
async function readBody(
  req: NodeIncoming,
  limit: number,
): Promise<Uint8Array | ReadableStream<Uint8Array> | undefined> {
  const cached = cachedBody(req);
  if (cached !== undefined) {
    const bytes = await toBytes(await cached, limit);
    if (bytes && bytes.byteLength > limit) throw payloadTooLarge(limit);
    return bytes;
  }
  if (!hasStreamedBody(req)) return undefined;
  const declared = Number.parseInt(firstHeader(req.headers["content-length"]) ?? "", 10);
  if (declared > limit) throw payloadTooLarge(limit);
  return streamOf(req, limit);
}

/**
 * The socket's body as a stream the Graft handler pulls from, so a handler
 * that refuses at its own smaller limit stops the read there instead of this
 * adapter buffering everything first. It errors once the body passes `limit`.
 */
function streamOf(req: NodeIncoming, limit: number): ReadableStream<Uint8Array> {
  const chunks = req[Symbol.asyncIterator]();
  let total = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const next = await chunks.next();
        if (next.done) return controller.close();
        const chunk =
          typeof next.value === "string" ? new TextEncoder().encode(next.value) : next.value;
        total += chunk.byteLength;
        if (total > limit) return controller.error(payloadTooLarge(limit));
        controller.enqueue(new Uint8Array(chunk));
      },
      cancel() {
        req.pause?.();
      },
    },
    { highWaterMark: 0 },
  );
}

function cachedBody(req: NodeIncoming): RawBody | Promise<RawBody> {
  return req[H3_RAW_BODY] ?? req.rawBody ?? req.body;
}

/** No length and not chunked means no body, the same test h3 1 uses. */
function hasStreamedBody(req: NodeIncoming): boolean {
  if (Number.parseInt(firstHeader(req.headers["content-length"]) ?? "", 10) > 0) return true;
  return (firstHeader(req.headers["transfer-encoding"]) ?? "").includes("chunked");
}

/** A cached Node stream, read to the end unless it passes `limit`. */
function collect(req: NodeReadable, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    req.on("data", (chunk: Uint8Array | string) => {
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      total += bytes.byteLength;
      if (total > limit) reject(payloadTooLarge(limit));
      else chunks.push(bytes);
    });
    req.on("end", () => resolve(concat(chunks)));
    req.on("error", (error: Error) => reject(error));
  });
}

async function toBytes(value: RawBody, limit: number): Promise<Uint8Array | undefined> {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof URLSearchParams) return new TextEncoder().encode(value.toString());
  if (value instanceof ReadableStream) {
    const init: NodeRequestInit = { method: "POST", body: value, duplex: "half" };
    return readBodyBytes(new Request("http://localhost", init), limit);
  }
  if (isNodeReadable(value)) return collect(value, limit);
  // A parsed JSON body, as nitropack's in-process fetch passes it.
  return new TextEncoder().encode(JSON.stringify(value));
}

function isNodeReadable(
  value: NodeReadable | { readonly [key: string]: unknown },
): value is NodeReadable {
  return "pipe" in value && typeof value.pipe === "function";
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `event.context.clientAddress`, which a Nitro preset sets from its platform. */
function clientAddress(event: NitroEvent): string | undefined {
  const fromEvent = nonEmpty(event.context?.clientAddress);
  if (fromEvent) return fromEvent;
  // h3 2 keeps context on the request.
  return event.req instanceof Request ? nonEmpty(event.req.context?.clientAddress) : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
