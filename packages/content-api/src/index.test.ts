import type {
  ContentIndexReader,
  ContentRow,
  ReaderReadOptions,
  ReaderSearchOptions,
} from "@usegraft/db";
import { afterEach, describe, expect, it } from "vitest";
import { createContentApiHandler, createContentApiReader } from "./index";

function row(overrides: Partial<ContentRow> = {}): ContentRow {
  return {
    branchId: "preview/copy",
    collection: "pages",
    slug: "home",
    data: { title: "Home" },
    body: "# Hello",
    contentHash: "sha256:home",
    sourcePath: "pages/home.mdx",
    deleted: false,
    updatedAt: new Date("2026-08-28T10:00:00.000Z"),
    search: null,
    ...overrides,
  };
}

function reader(options?: {
  onRead?: (input: ReaderReadOptions) => void;
  onSearch?: (input: ReaderSearchOptions) => void;
}): ContentIndexReader {
  return {
    async readContent(input) {
      options?.onRead?.(input);
      return [row()];
    },
    async searchContent(input) {
      options?.onSearch?.(input);
      return [{ row: row(), rank: 0.75, snippet: "<b>Hello</b>" }];
    },
    async close() {},
  };
}

function handlerFetch(
  handler: (request: Request) => Promise<Response>,
  inspect?: (request: Request) => void,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    inspect?.(request);
    return handler(request);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function errorBody(response: Response): Promise<{
  error: string;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}> {
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.error !== "string" || typeof body.message !== "string") {
    throw new Error("expected a GraftError JSON body");
  }
  const parsed: {
    error: string;
    message: string;
    fix?: string;
    details?: Record<string, unknown>;
  } = { error: body.error, message: body.message };
  if (typeof body.fix === "string") parsed.fix = body.fix;
  if (isRecord(body.details)) parsed.details = body.details;
  return parsed;
}

describe("createContentApiHandler", () => {
  it("routes document reads, clamps limits, and fixes reads to the mounted branch", async () => {
    let received: ReaderReadOptions | undefined;
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "preview/copy",
      index: reader({ onRead: (input) => (received = input) }),
    });

    const response = await handler(
      new Request(
        "http://localhost/api/content/v1/documents?collection=pages&slug=home&limit=9999&offset=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(received).toEqual({
      collection: "pages",
      slug: "home",
      limit: 500,
      offset: 2,
      branch: "preview/copy",
    });
    expect(await response.json()).toEqual({
      rows: [
        {
          branchId: "preview/copy",
          collection: "pages",
          slug: "home",
          data: { title: "Home" },
          body: "# Hello",
          contentHash: "sha256:home",
          sourcePath: "pages/home.mdx",
          deleted: false,
          updatedAt: "2026-08-28T10:00:00.000Z",
          search: null,
        },
      ],
    });
  });

  it("routes ranked search hits with the fixed branch", async () => {
    let received: ReaderSearchOptions | undefined;
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader({ onSearch: (input) => (received = input) }),
    });

    const response = await handler(
      new Request("http://localhost/api/content/v1/search?collection=pages&query=hello&limit=10"),
    );

    expect(received).toEqual({
      collections: ["pages"],
      query: "hello",
      limit: 10,
      branch: "main",
    });
    expect(await response.json()).toMatchObject({
      hits: [{ rank: 0.75, snippet: "<b>Hello</b>", row: { slug: "home" } }],
    });
  });

  it.each([
    ["/api/content/v1/documents", "GET", 400, "INPUT_VALIDATION_FAILED"],
    ["/api/content/v1/documents?collection=pages&slug=", "GET", 400, "INPUT_VALIDATION_FAILED"],
    ["/api/content/v1/search?collection=pages", "GET", 400, "INPUT_VALIDATION_FAILED"],
    ["/api/content/v1/documents?collection=missing", "GET", 404, "COLLECTION_NOT_FOUND"],
    ["/api/content/v1/documents?collection=pages&limit=-1", "GET", 400, "INPUT_VALIDATION_FAILED"],
    ["/api/content/v1/documents?collection=pages&limit=1.5", "GET", 400, "INPUT_VALIDATION_FAILED"],
    ["/api/content/v1/documents?collection=pages&offset=-1", "GET", 400, "INPUT_VALIDATION_FAILED"],
    [
      "/api/content/v1/documents?collection=pages&offset=one",
      "GET",
      400,
      "INPUT_VALIDATION_FAILED",
    ],
    ["/api/content/v1/search?collection=pages&query=%20", "GET", 400, "INPUT_VALIDATION_FAILED"],
    [
      "/api/content/v1/documents?collection=pages&branch=preview",
      "GET",
      400,
      "INPUT_VALIDATION_FAILED",
    ],
    ["/api/content/v1/documents?collection=pages", "POST", 405, "METHOD_NOT_ALLOWED"],
    ["/api/content/v1/unknown", "GET", 404, "ROUTE_NOT_FOUND"],
  ])("rejects invalid request %s", async (path, method, status, code) => {
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader(),
    });
    const response = await handler(new Request(`http://localhost${path}`, { method }));

    expect(response.status).toBe(status);
    expect((await errorBody(response)).error).toBe(code);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    if (status === 405) expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("createContentApiReader", () => {
  it("round-trips rows and hits through the real handler-backed protocol", async () => {
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "preview/copy",
      index: reader(),
    });
    const seenRequests: Request[] = [];
    const remote = createContentApiReader({
      endpoint: "http://content.test/api/content/v1/",
      headers: { authorization: "Bearer secret" },
      fetch: handlerFetch(handler, (request) => seenRequests.push(request)),
    });

    const rows = await remote.readContent({
      collection: "pages",
      slug: "home",
      branch: "caller-selected-branch",
    });
    const hits = await remote.searchContent({
      collections: ["pages"],
      query: "hello",
      branch: "another-caller-branch",
    });

    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
    expect(rows[0]?.updatedAt.toISOString()).toBe("2026-08-28T10:00:00.000Z");
    expect(hits[0]).toMatchObject({ rank: 0.75, snippet: "<b>Hello</b>" });
    expect(hits[0]?.row.updatedAt).toBeInstanceOf(Date);
    expect(seenRequests).toHaveLength(2);
    for (const request of seenRequests) {
      expect(request.headers.get("authorization")).toBe("Bearer secret");
      expect(new URL(request.url).searchParams.has("branch")).toBe(false);
    }
  });

  it("refuses search across zero or many collections", async () => {
    const remote = createContentApiReader({
      endpoint: "http://content.test/api/content/v1",
      fetch: async () => {
        throw new Error("search must fail before fetch when the collection count is wrong");
      },
    });

    await expect(remote.searchContent({ collections: [], query: "hello" })).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      fix: "Pass collections: [name]. Graft SDK searchDocuments already does this.",
    });
    await expect(
      remote.searchContent({ collections: ["pages", "docs"], query: "hello" }),
    ).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
  });

  it("revives a remote GraftError without losing its fix or details", async () => {
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader(),
    });
    const remote = createContentApiReader({
      endpoint: "http://content.test/api/content/v1",
      fetch: handlerFetch(handler),
    });

    await expect(remote.readContent({ collection: "missing" })).rejects.toMatchObject({
      code: "COLLECTION_NOT_FOUND",
      fix: "Use one of the registered collections: pages.",
      details: { collection: "missing", registered: ["pages"] },
    });
  });

  it.each([
    ["missing rows wrapper", () => Response.json({ documents: [] }), /"rows" array/],
    [
      "invalid date",
      () =>
        Response.json({
          rows: [{ ...JSON.parse(JSON.stringify(row())), updatedAt: "not-a-date" }],
        }),
      /invalid updatedAt/,
    ],
    [
      "malformed hit",
      () => Response.json({ hits: [{ row: JSON.parse(JSON.stringify(row())), rank: "high" }] }),
      /malformed search hit/,
    ],
  ])("rejects %s payloads", async (_name, response, message) => {
    const remote = createContentApiReader({
      endpoint: "http://content.test/api/content/v1",
      fetch: async () => response(),
    });

    const operation =
      _name === "malformed hit"
        ? remote.searchContent({ collections: ["pages"], query: "hello" })
        : remote.readContent({ collection: "pages" });
    await expect(operation).rejects.toMatchObject({
      code: "FUNCTION_EXECUTION_FAILED",
      message: expect.stringMatching(message),
      fix: expect.stringContaining("/api/content/v1"),
    });
  });

  // The relative form is what /docs/reading-content and the createGraft JSDoc
  // both tell people to write, and it threw `TypeError: Invalid URL` before a
  // single read. Found in the pull request review.
  describe("endpoint resolution", () => {
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

    afterEach(() => {
      // SAFETY: widening-only, to restore the pre-test shape of globalThis.
      // The property was installed by this suite and is configurable.
      const global = globalThis as { location?: unknown };
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
      else delete global.location;
    });

    function pretendBrowser(href: string): void {
      Object.defineProperty(globalThis, "location", {
        value: { href, origin: new URL(href).origin },
        configurable: true,
        writable: true,
      });
    }

    it("resolves a same-origin path against the page origin", async () => {
      pretendBrowser("https://app.test/blog/hello");
      const seen: Request[] = [];
      const remote = createContentApiReader({
        endpoint: "/api/content/v1",
        fetch: async (input) => {
          seen.push(new Request(input));
          return Response.json({ rows: [] });
        },
      });

      await remote.readContent({ collection: "pages" });
      expect(new URL(seen[0]!.url).origin).toBe("https://app.test");
      expect(new URL(seen[0]!.url).pathname).toBe("/api/content/v1/documents");
    });

    it("still accepts an absolute endpoint in a browser", async () => {
      pretendBrowser("https://app.test/blog/hello");
      const seen: Request[] = [];
      const remote = createContentApiReader({
        endpoint: "https://cms.example.com/api/content/v1",
        fetch: async (input) => {
          seen.push(new Request(input));
          return Response.json({ rows: [] });
        },
      });

      await remote.readContent({ collection: "pages" });
      expect(new URL(seen[0]!.url).origin).toBe("https://cms.example.com");
    });

    it("refuses a relative endpoint outside a browser, with the reason", () => {
      // SAFETY: widening-only. Removing the property is the point of this
      // case: it reproduces a non-browser runtime.
      delete (globalThis as { location?: unknown }).location;
      expect(() => createContentApiReader({ endpoint: "/api/content/v1" })).toThrow(
        /not a valid URL/,
      );
      try {
        createContentApiReader({ endpoint: "/api/content/v1" });
      } catch (error) {
        expect(error).toMatchObject({
          code: "CONFIG_INVALID",
          fix: expect.stringContaining("no page origin"),
        });
      }
    });
  });

  it("turns non-Graft and non-JSON responses into actionable GraftErrors", async () => {
    for (const response of [
      new Response("<html>proxy error</html>", { status: 502 }),
      Response.json({ message: "plain error" }, { status: 500 }),
    ]) {
      const remote = createContentApiReader({
        endpoint: "http://content.test/api/content/v1",
        fetch: async () => response.clone(),
      });
      await expect(remote.readContent({ collection: "pages" })).rejects.toMatchObject({
        code: "FUNCTION_EXECUTION_FAILED",
        fix: expect.stringContaining("proxy"),
      });
    }
  });
});

describe("rate limit", () => {
  const DOCUMENTS = "http://localhost/api/content/v1/documents?collection=pages";

  it("admits the limit and refuses the next, with Retry-After", async () => {
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader(),
      rateLimit: { limit: 60, windowSeconds: 60 },
    });

    for (let i = 0; i < 60; i++) {
      const response = await handler(new Request(DOCUMENTS));
      expect(response.status, `request ${i + 1} of 60`).toBe(200);
    }

    // The 61st is the one Greptile's reproduction showed returning 200 with no
    // Retry-After, which is what this asserts against.
    const refused = await handler(new Request(DOCUMENTS));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");

    const body = await errorBody(refused);
    expect(body.error).toBe("RATE_LIMITED");
    expect(body.fix).toContain("Retry-After");
  });

  it("does not read the index once a caller is over the limit", async () => {
    let reads = 0;
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader({ onRead: () => void reads++ }),
      rateLimit: { limit: 2, windowSeconds: 60 },
    });

    await handler(new Request(DOCUMENTS));
    await handler(new Request(DOCUMENTS));
    await handler(new Request(DOCUMENTS));

    // The point of the limit is the database work it prevents, not the status
    // code — a 429 issued after the query has already run protects nothing.
    expect(reads).toBe(2);
  });

  it("is unlimited when no rateLimit is configured", async () => {
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader(),
    });

    for (let i = 0; i < 100; i++) {
      expect((await handler(new Request(DOCUMENTS))).status).toBe(200);
    }
  });

  it("charges a refused method to nobody's bucket", async () => {
    const handler = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader(),
      rateLimit: { limit: 2, windowSeconds: 60 },
    });

    // A 405 is refused before the limiter, so a caller probing with the wrong
    // method cannot spend another caller's shared "unknown" budget.
    for (let i = 0; i < 5; i++) {
      expect((await handler(new Request(DOCUMENTS, { method: "POST" }))).status).toBe(405);
    }
    expect((await handler(new Request(DOCUMENTS))).status).toBe(200);
    expect((await handler(new Request(DOCUMENTS))).status).toBe(200);
    expect((await handler(new Request(DOCUMENTS))).status).toBe(429);
  });
});

describe("CORS", () => {
  const DOCS = "http://localhost/api/content/v1/documents?collection=pages";
  const APP = "https://app.example.com";

  function handler(allowedOrigins?: readonly string[] | "*") {
    return createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader(),
      ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
    });
  }

  it("sends nothing when no origins are configured", async () => {
    // Same-origin only is the default, because publishing to other origins is
    // the deployer's decision.
    const response = await handler()(new Request(DOCS, { headers: { origin: APP } }));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes an allowed origin and varies on it", async () => {
    const response = await handler([APP])(new Request(DOCS, { headers: { origin: APP } }));
    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
    // Without Vary a shared cache can hand one origin another's response.
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("stays silent for an origin not on the list, without failing the request", async () => {
    // The browser enforces this. Refusing outright would make the allowlist an
    // origin oracle for non-browser callers, who are not bound by CORS anyway.
    const response = await handler([APP])(
      new Request(DOCS, { headers: { origin: "https://evil.test" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight without touching the index or the limiter", async () => {
    let reads = 0;
    const h = createContentApiHandler({
      collections: ["pages"],
      branch: "main",
      index: reader({ onRead: () => void reads++ }),
      allowedOrigins: [APP],
      rateLimit: { limit: 1, windowSeconds: 60 },
    });

    for (let i = 0; i < 5; i++) {
      const pre = await h(
        new Request(DOCS, {
          method: "OPTIONS",
          headers: { origin: APP, "access-control-request-headers": "authorization" },
        }),
      );
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-methods")).toContain("GET");
      expect(pre.headers.get("access-control-allow-headers")).toBe("authorization");
    }

    expect(reads).toBe(0);
    // Five preflights did not spend the one-request budget.
    expect((await h(new Request(DOCS, { headers: { origin: APP } }))).status).toBe(200);
  });

  it("puts the headers on errors too, so the browser can show the fix", async () => {
    const response = await handler([APP])(
      new Request("http://localhost/api/content/v1/documents", { headers: { origin: APP } }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe(APP);
  });

  it("allows any origin with a wildcard", async () => {
    const response = await handler("*")(
      new Request(DOCS, { headers: { origin: "https://anything.test" } }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
