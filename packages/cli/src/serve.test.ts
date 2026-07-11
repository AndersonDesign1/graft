/**
 * graft serve — the router (what is mounted where) and the thin Node adapter
 * (node:http ↔ Web-standard Request/Response), both without a database: the
 * mounted handlers are stubs, because functions/MCP behavior is owned and
 * tested by @graft/core and @graft/mcp. Full-stack behavior is covered by the
 * live smoke against the example app.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeListener, createServeRouter, type FetchHandler } from "./commands/serve";

const echo =
  (label: string): FetchHandler =>
  async (request) =>
    new Response(JSON.stringify({ label, method: request.method, url: request.url }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

describe("createServeRouter", () => {
  const router = createServeRouter({ fn: echo("fn"), mcp: echo("mcp"), health: echo("health") });

  it("mounts /healthz, /api/mcp, and /api/fn/<name>", async () => {
    for (const [path, label] of [
      ["/healthz", "health"],
      ["/api/mcp", "mcp"],
      ["/api/fn/pageStats", "fn"],
      ["/api/fn", "fn"], // handler answers FUNCTION_NOT_FOUND itself
    ] as const) {
      const res = await router(new Request(`http://localhost${path}`, { method: "POST" }));
      expect(((await res.json()) as { label: string }).label).toBe(label);
    }
  });

  it("404s unmounted paths with a GraftError that teaches the route map", async () => {
    const res = await router(new Request("http://localhost/api/fns/typo"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: string;
      fix: string;
      details: { pathname: string };
    };
    expect(body.error).toBe("ROUTE_NOT_FOUND");
    expect(body.fix).toContain("/api/fn/<name>");
    expect(body.fix).toContain("/healthz");
    expect(body.details.pathname).toBe("/api/fns/typo");
  });
});

describe("createNodeListener", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        (server as Server).close((err) => (err ? reject(err) : resolve())),
      );
      server = undefined;
    }
  });

  async function listen(handler: FetchHandler): Promise<string> {
    server = createServer(createNodeListener(handler));
    await new Promise<void>((resolve) => (server as Server).listen(0, "127.0.0.1", resolve));
    const { port } = (server as Server).address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("round-trips method, path, headers, and body", async () => {
    const base = await listen(async (request) => {
      const body = await request.text();
      return new Response(
        JSON.stringify({
          method: request.method,
          pathname: new URL(request.url).pathname,
          authorization: request.headers.get("authorization"),
          body,
        }),
        { status: 201, headers: { "content-type": "application/json", "x-custom": "yes" } },
      );
    });

    const res = await fetch(`${base}/api/fn/submitContact`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sekrit" },
      body: JSON.stringify({ email: "a@b.co" }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-custom")).toBe("yes");
    expect(await res.json()).toEqual({
      method: "POST",
      pathname: "/api/fn/submitContact",
      authorization: "Bearer sekrit",
      body: '{"email":"a@b.co"}',
    });
  });

  it("GET requests carry no body and still round-trip", async () => {
    const base = await listen(async (request) =>
      Response.json({ method: request.method, hasBody: request.body !== null }),
    );
    const res = await fetch(`${base}/healthz`);
    expect(await res.json()).toEqual({ method: "GET", hasBody: false });
  });

  it("a throwing handler becomes 500 GraftError JSON, not a hung socket", async () => {
    const base = await listen(async () => {
      throw new Error("boom");
    });
    const res = await fetch(base, { method: "POST", body: "{}" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("FUNCTION_EXECUTION_FAILED");
    expect(body.message).toContain("boom");
  });
});
