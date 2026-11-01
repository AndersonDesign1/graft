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
import { GraftError, setRequestPeer } from "@usegraft/contracts";

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
}

/** The Request h3 2 hands a handler: a Web `Request` plus what the server knew. */
export interface ServerRequest extends Request {
  /** The socket address, set by the server adapter (srvx). */
  readonly ip?: string;
  readonly context?: { readonly clientAddress?: string };
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
  readonly context?: { readonly clientAddress?: string } | undefined;
}

/** A Nitro event handler over a Graft handler. Works on h3 1 and h3 2. */
export function graftHandler(handler: FetchHandler) {
  return async (event: NitroEvent): Promise<Response> => handler(await toGraftRequest(event));
}

/**
 * The Web `Request` behind an h3 event, with its socket address registered as
 * the peer. Exported for apps that need the Request before deciding which
 * Graft handler to call.
 */
export async function toGraftRequest(event: NitroEvent): Promise<Request> {
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
    const request = await fromNodeRequest(nodeReq);
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

async function fromNodeRequest(req: NodeIncoming): Promise<Request> {
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
  const url = new URL(path, `${protocol}://${headers.get("host") ?? "localhost"}`);
  const body = PAYLOAD_METHODS.has(method) ? await readBody(req) : undefined;
  // They described the bytes on the wire. The body here may be re-encoded,
  // such as a parsed object serialized back to JSON, so they would be wrong.
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return new Request(url, {
    method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
  });
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
async function readBody(req: NodeIncoming): Promise<Uint8Array | undefined> {
  const cached = cachedBody(req);
  if (cached !== undefined) return toBytes(await cached);
  if (!hasStreamedBody(req)) return undefined;
  return collect(req);
}

function cachedBody(req: NodeIncoming): RawBody | Promise<RawBody> {
  return req[H3_RAW_BODY] ?? req.rawBody ?? req.body;
}

/** No length and not chunked means no body, the same test h3 1 uses. */
function hasStreamedBody(req: NodeIncoming): boolean {
  if (Number.parseInt(firstHeader(req.headers["content-length"]) ?? "", 10) > 0) return true;
  return (firstHeader(req.headers["transfer-encoding"]) ?? "").includes("chunked");
}

function collect(req: NodeReadable | NodeIncoming): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array | string) => {
      chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    });
    req.on("end", () => resolve(concat(chunks)));
    req.on("error", (error: Error) => reject(error));
  });
}

async function toBytes(value: RawBody): Promise<Uint8Array | undefined> {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof URLSearchParams) return new TextEncoder().encode(value.toString());
  if (value instanceof ReadableStream)
    return new Uint8Array(await new Response(value).arrayBuffer());
  if (isNodeReadable(value)) return collect(value);
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

function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}
