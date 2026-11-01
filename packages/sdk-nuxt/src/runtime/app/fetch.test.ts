import { describe, expect, it } from "vitest";
import { fetchVia, type RequestFetch } from "./fetch";

describe("fetchVia", () => {
  it("asks Nuxt's fetch for the path alone, and answers with its status and body", async () => {
    const calls: { path: string; method: string }[] = [];
    const requestFetch: RequestFetch = async (path, options) => {
      calls.push({ path, method: options.method });
      options.onResponse({
        response: new Response(null, {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        }),
      });
      return '{"error":"DOCUMENT_NOT_FOUND"}';
    };

    const response = await fetchVia(requestFetch)(
      "https://site.test/api/content/v1/documents?collection=pages&slug=home",
    );

    expect(calls).toEqual([
      { path: "/api/content/v1/documents?collection=pages&slug=home", method: "GET" },
    ]);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({ error: "DOCUMENT_NOT_FOUND" });
  });

  it("takes a Request as well as a URL, and passes its method and headers on", async () => {
    let seen: { method: string; headers?: HeadersInit } | undefined;
    const requestFetch: RequestFetch = async (_path, options) => {
      seen = { method: options.method, headers: options.headers };
      return "[]";
    };

    const response = await fetchVia(requestFetch)(
      new Request("https://site.test/api/content/v1/search?q=x", {
        headers: { authorization: "Bearer t" },
      }),
    );

    expect(seen?.method).toBe("GET");
    expect(new Headers(seen?.headers).get("authorization")).toBe("Bearer t");
    expect(response.status).toBe(200);
  });

  it("lets init override what the Request carries", async () => {
    let seen: { method: string; headers?: HeadersInit } | undefined;
    const requestFetch: RequestFetch = async (_path, options) => {
      seen = { method: options.method, headers: options.headers };
      return "[]";
    };

    await fetchVia(requestFetch)(
      new Request("https://site.test/api/content/v1/search?q=x", {
        headers: { authorization: "Bearer request" },
      }),
      { method: "GET", headers: { authorization: "Bearer init" } },
    );

    expect(seen).toEqual({ method: "GET", headers: { authorization: "Bearer init" } });
  });
});
