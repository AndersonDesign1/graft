/**
 * Static-asset serving. The flat "no slashes" allowlist had to go so Vite's
 * hashed `assets/*` output could be served; confinement is now done by
 * resolving and checking the result is still under dist/ui. These lock that
 * down, plus the branch pinning the shell redirect performs.
 *
 * uiRoot() resolves to `<this dir>/ui`, which is `src/ui` under vitest — it
 * has an index.html, so the happy paths are real reads.
 */
import { describe, expect, it } from "vitest";
import { createStudioHandler } from "./handler";

const base = {
  db: {} as never,
  collections: {},
  contentDir: "/tmp/graft-content",
};

const get = (handler: ReturnType<typeof createStudioHandler>, path: string) =>
  handler(new Request(`http://localhost${path}`, { redirect: "manual" }));

describe("static UI serving", () => {
  it("serves the shell at / when mounted at the root", async () => {
    const handler = createStudioHandler(base);
    const res = await get(handler, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // The shell must never be cached, or a redeploy serves stale asset refs.
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves nested assets/ paths", async () => {
    const handler = createStudioHandler(base);
    const res = await get(handler, "/styles/studio.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("refuses to escape the ui root", async () => {
    const handler = createStudioHandler(base);
    for (const path of [
      "/../package.json",
      "/../../package.json",
      "/assets/../../package.json",
      "/..%2f..%2fpackage.json",
      "/styles/../../../package.json",
    ]) {
      const res = await get(handler, path);
      expect(res.status, `${path} must not resolve`).toBe(404);
    }
  });

  it("redirects the bare mount path to a trailing slash", async () => {
    const handler = createStudioHandler({ ...base, uiBasePath: "/studio" });
    const res = await get(handler, "/studio");
    expect(res.status).toBe(302);
    // Relative ./assets/* only resolve correctly under /studio/.
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/studio/");
  });

  it("pins the mounted branch onto the shell URL", async () => {
    // The SPA reads ?branch from the URL, so a handler mounted on a preview
    // branch has to say so — otherwise /studio/ silently showed main.
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      defaultBranch: "preview/checkout",
    });
    const res = await get(handler, "/studio");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.searchParams.get("branch")).toBe("preview/checkout");
  });

  it("leaves an explicit branch alone", async () => {
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      defaultBranch: "main",
    });
    const res = await get(handler, "/studio/?branch=other");
    // Already has a branch and a trailing slash — nothing to redirect for.
    expect(res.status).toBe(200);
  });

  it("does not redirect in a loop once the branch is pinned", async () => {
    const handler = createStudioHandler({
      ...base,
      uiBasePath: "/studio",
      defaultBranch: "main",
    });
    const first = await get(handler, "/studio");
    const location = first.headers.get("location") ?? "";
    const second = await handler(new Request(location, { redirect: "manual" }));
    expect(second.status).toBe(200);
  });

  it("still routes the API ahead of static assets", async () => {
    const handler = createStudioHandler({ ...base, uiBasePath: "/studio" });
    const res = await get(handler, "/api/studio/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
