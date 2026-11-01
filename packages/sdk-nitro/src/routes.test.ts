/**
 * graftHandler on real h3 servers, one per major: h3 1 is what Nuxt 4 runs
 * (through nitropack 2), h3 2 is what Nitro 3 and Nuxt 5 run. Each test sends
 * a real HTTP request through `node:http` and asserts what the Graft handler
 * received and what the client got back.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestPeer } from "@usegraft/contracts";
import * as h3v1 from "h3-v1";
import { H3, toNodeListener as toNodeListenerV2 } from "h3-v2";
import { afterEach, describe, expect, it } from "vitest";
import { graftHandler, toGraftRequest, type FetchHandler } from "./routes";

interface Seen {
  method: string;
  url: string;
  body: string;
  authorization: string | null;
  peer: string | undefined;
}

/** A stand-in Graft handler: records what it got, answers like MCP does. */
function recorder() {
  const seen: Seen[] = [];
  const handler: FetchHandler = async (request) => {
    seen.push({
      method: request.method,
      url: request.url,
      body: await request.text(),
      authorization: request.headers.get("authorization"),
      peer: getRequestPeer(request),
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message\ndata: {"ok":true}\n\n'));
        controller.close();
      },
    });
    const headers = new Headers({ "content-type": "text/event-stream" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    return new Response(stream, { status: 201, headers });
  };
  return { handler, seen };
}

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(listener: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(listener);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  // SAFETY: a server listening on a TCP port reports an AddressInfo, not a pipe path.
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const post = (url: string): Promise<Response> =>
  fetch(url, {
    method: "POST",
    body: '{"jsonrpc":"2.0","id":1}',
    headers: { authorization: "Bearer agent-token", "content-type": "application/json" },
  });

describe("graftHandler on h3 1 (Nuxt 4, nitropack 2)", () => {
  it("relays method, path, body and headers, registers the socket peer, and streams the response back", async () => {
    const { handler, seen } = recorder();
    const app = h3v1.createApp();
    app.use("/api/mcp", h3v1.eventHandler(graftHandler(handler)));
    const base = await listen(h3v1.toNodeListener(app));

    const response = await post(`${base}/api/mcp?session=1`);

    expect(seen).toEqual([
      {
        method: "POST",
        url: `${base}/api/mcp?session=1`,
        body: '{"jsonrpc":"2.0","id":1}',
        authorization: "Bearer agent-token",
        peer: "127.0.0.1",
      },
    ]);
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(await response.text()).toBe('event: message\ndata: {"ok":true}\n\n');
  });

  it("keeps the full path when a router mounts the handler under a prefix", async () => {
    const { handler, seen } = recorder();
    const router = h3v1.createRouter().post("/fn/:name", h3v1.eventHandler(graftHandler(handler)));
    const app = h3v1.createApp().use("/api", router.handler);
    const base = await listen(h3v1.toNodeListener(app));

    await post(`${base}/api/fn/submit-form`);

    expect(seen[0]?.url).toBe(`${base}/api/fn/submit-form`);
  });

  it("reads a body a middleware already consumed through h3's readBody", async () => {
    const { handler, seen } = recorder();
    const app = h3v1.createApp();
    app.use(
      h3v1.eventHandler(async (event) => {
        await h3v1.readBody(event);
      }),
    );
    app.use("/api/mcp", h3v1.eventHandler(graftHandler(handler)));
    const base = await listen(h3v1.toNodeListener(app));

    await post(`${base}/api/mcp`);

    expect(seen[0]?.body).toBe('{"jsonrpc":"2.0","id":1}');
  });

  it("reads the body of nitropack's in-process fetch, which sits on req.body and never streams", async () => {
    // What a Nuxt page's server-side `$fetch("/api/fn/x", { method: "POST", body })`
    // hands the route: no socket, a parsed body on `req.body`, and a stream
    // that never emits. Reading only the stream would hang or come back empty.
    const { handler, seen } = recorder();
    const req = {
      method: "POST",
      url: "/api/fn/submit-form",
      headers: { host: "localhost", "content-type": "application/json", "content-length": "11" },
      body: { email: "a" },
      socket: null,
      on: () => req,
    };
    // SAFETY: the stand-in carries every field h3's createEvent reads.
    const event = h3v1.createEvent(req as never, {} as never);

    const lengths: (string | null)[] = [];
    await graftHandler(async (request) => {
      lengths.push(request.headers.get("content-length"));
      return handler(request);
    })(event);

    // The stand-in declared 11 bytes; the JSON it carries is 13.
    expect(lengths).toEqual([null]);
    expect(seen).toEqual([
      {
        method: "POST",
        url: "http://localhost/api/fn/submit-form",
        body: '{"email":"a"}',
        authorization: null,
        peer: undefined,
      },
    ]);
  });

  it("answers a bodiless in-process POST instead of waiting on a stream that never ends", async () => {
    const { handler, seen } = recorder();
    // `$fetch("/api/fn/x", { method: "POST" })` from a page: no body, no length.
    const req = {
      method: "POST",
      url: "/api/fn/ping",
      headers: { host: "localhost" },
      socket: null,
      on: () => req,
    };
    // SAFETY: the stand-in carries every field h3's createEvent reads.
    const event = h3v1.createEvent(req as never, {} as never);

    await graftHandler(handler)(event);

    expect(seen[0]).toMatchObject({ method: "POST", body: "" });
  });

  it("drops a body left on a GET, which a Web Request cannot carry", async () => {
    const { handler, seen } = recorder();
    const req = {
      method: "GET",
      url: "/api/fn/ping",
      headers: { host: "localhost", "content-length": "2" },
      body: "{}",
      socket: null,
      on: () => req,
    };
    // SAFETY: the stand-in carries every field h3's createEvent reads.
    const event = h3v1.createEvent(req as never, {} as never);

    await graftHandler(handler)(event);

    expect(seen[0]).toMatchObject({ method: "GET", body: "" });
  });

  it("keeps the server's origin when the request target starts with //", async () => {
    const { handler, seen } = recorder();
    const req = {
      method: "GET",
      url: "//evil.test/api/mcp",
      headers: { host: "site.test" },
      socket: null,
      on: () => req,
    };
    // SAFETY: the stand-in carries every field h3's createEvent reads.
    await graftHandler(handler)(h3v1.createEvent(req as never, {} as never));

    expect(seen[0]?.url).toBe("http://site.test//evil.test/api/mcp");
  });

  it("falls back to localhost when the Host header is not a host", async () => {
    const { handler, seen } = recorder();
    const req = {
      method: "GET",
      url: "/api/mcp",
      headers: { host: "not a host" },
      socket: null,
      on: () => req,
    };
    // SAFETY: the stand-in carries every field h3's createEvent reads.
    await graftHandler(handler)(h3v1.createEvent(req as never, {} as never));

    expect(seen[0]?.url).toBe("http://localhost/api/mcp");
  });

  it("sends no body for a GET, so the handler can answer 405", async () => {
    const { handler, seen } = recorder();
    const app = h3v1.createApp().use("/api/fn", h3v1.eventHandler(graftHandler(handler)));
    const base = await listen(h3v1.toNodeListener(app));

    await fetch(`${base}/api/fn/submit-form`);

    expect(seen[0]).toMatchObject({ method: "GET", body: "" });
  });
});

describe("graftHandler body limit on h3 1", () => {
  async function h3v1Server(handler: FetchHandler, maxBodyBytes: number): Promise<string> {
    const app = h3v1.createApp();
    app.use("/api/fn", h3v1.eventHandler(graftHandler(handler, { maxBodyBytes })));
    return listen(h3v1.toNodeListener(app));
  }

  it("refuses a declared body over maxBodyBytes with 413 before the handler runs", async () => {
    let reached = 0;
    const base = await h3v1Server(async () => {
      reached += 1;
      return new Response("ran");
    }, 100);

    const response = await fetch(`${base}/api/fn/x`, { method: "POST", body: "x".repeat(101) });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: "PAYLOAD_TOO_LARGE",
      details: { limit: 100 },
    });
    expect(reached).toBe(0);
    const fits = await fetch(`${base}/api/fn/x`, { method: "POST", body: "x".repeat(100) });
    expect(await fits.text()).toBe("ran");
  });

  it("errors a chunked body with no length once it passes maxBodyBytes", async () => {
    const base = await h3v1Server(async (request) => {
      const failure = await request.arrayBuffer().then(
        () => null,
        (error: unknown) => error,
      );
      return Response.json({ failed: failure instanceof Error ? failure.message : null });
    }, 100);

    const response = await fetch(`${base}/api/fn/x`, {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(80)));
          controller.enqueue(new TextEncoder().encode("x".repeat(80)));
          controller.close();
        },
      }),
      // Node's fetch needs this for a stream body.
      duplex: "half",
    });

    expect(await response.json()).toEqual({ failed: expect.stringMatching(/100 bytes/) });
  });

  it("streams the body to the handler, so one that stops early never pulls the rest", async () => {
    let pulled = 0;
    const base = await h3v1Server(
      async (request) => {
        const reader = request.body?.getReader();
        const first = await reader?.read();
        pulled += first?.value?.byteLength ?? 0;
        await reader?.cancel();
        return new Response("stopped", { status: 413 });
      },
      32 * 1024 * 1024,
    );

    const response = await fetch(`${base}/api/fn/x`, {
      method: "POST",
      body: "x".repeat(4 * 1024 * 1024),
    });

    expect(response.status).toBe(413);
    expect(pulled).toBeGreaterThan(0);
    expect(pulled).toBeLessThan(4 * 1024 * 1024);
  });

  it("refuses an in-process body over maxBodyBytes, though it never touched a socket", async () => {
    let reached = 0;
    const req = {
      method: "POST",
      url: "/api/fn/x",
      headers: { host: "localhost", "content-type": "application/json" },
      body: { message: "x".repeat(200) },
      socket: null,
      on: () => req,
    };
    // SAFETY: the stand-in carries every field h3's createEvent reads.
    const event = h3v1.createEvent(req as never, {} as never);

    const response = await graftHandler(
      async () => {
        reached += 1;
        return new Response("ran");
      },
      { maxBodyBytes: 100 },
    )(event);

    expect(response.status).toBe(413);
    expect(reached).toBe(0);
  });

  it("refuses a limit that is not a byte count when it is built, instead of reading without one", () => {
    expect(() => graftHandler(async () => new Response(), { maxBodyBytes: Number.NaN })).toThrow(
      expect.objectContaining({ code: "CONFIG_INVALID" }),
    );
  });
});

describe("graftHandler on h3 2 (Nitro 3, Nuxt 5)", () => {
  it("passes event.req through, registers the socket peer, and streams the response back", async () => {
    const { handler, seen } = recorder();
    const app = new H3().post("/api/mcp", graftHandler(handler));
    const base = await listen(toNodeListenerV2(app));

    const response = await post(`${base}/api/mcp?session=1`);

    expect(seen).toEqual([
      {
        method: "POST",
        url: `${base}/api/mcp?session=1`,
        body: '{"jsonrpc":"2.0","id":1}',
        authorization: "Bearer agent-token",
        peer: "127.0.0.1",
      },
    ]);
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(await response.text()).toBe('event: message\ndata: {"ok":true}\n\n');
  });

  it("hands the handler event.req itself rather than a rebuilt copy", async () => {
    // Nitro 3 also keeps a compatibility event.node.req. Rebuilding from it
    // would buffer the body and drop what the server put on the Request.
    const received: boolean[] = [];
    const app = new H3().post("/api/mcp", (event) =>
      graftHandler(async (request) => {
        received.push(request === event.req);
        return new Response(null, { status: 204 });
      })(event),
    );
    const base = await listen(toNodeListenerV2(app));

    await post(`${base}/api/mcp`);

    expect(received).toEqual([true]);
  });

  it("never takes the peer from x-forwarded-for, which any client can send", async () => {
    const { handler, seen } = recorder();
    const app = new H3().post("/api/mcp", graftHandler(handler));
    const base = await listen(toNodeListenerV2(app));

    await fetch(`${base}/api/mcp`, {
      method: "POST",
      body: "{}",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    expect(seen[0]?.peer).toBe("127.0.0.1");
  });
});

describe("toGraftRequest", () => {
  it("prefers the platform address a Nitro preset puts on event.context", async () => {
    const request = new Request("http://site.test/api/mcp", { method: "POST" });
    const resolved = await toGraftRequest({
      web: { request },
      context: { clientAddress: "198.51.100.4" },
    });

    expect(resolved).toBe(request);
    expect(getRequestPeer(resolved)).toBe("198.51.100.4");
  });

  it("refuses an event that carries no request, naming the h3 versions it reads", async () => {
    await expect(toGraftRequest({})).rejects.toMatchObject({
      name: "GraftError",
      code: "FRAMEWORK_VERSION_UNSUPPORTED",
      message: expect.stringMatching(/`event\.req` \(h3 2\).*`event\.node\.req` \(h3 1\)/),
    });
  });
});
