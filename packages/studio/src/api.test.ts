import { describe, expect, it } from "vitest";
import { createStudioApiHandler } from "./api";
import { STUDIO_OPENAPI } from "./openapi";

const baseOpts = {
  db: {} as never,
  collections: {},
  contentDir: "/tmp/graft-content",
};

describe("createStudioApiHandler", () => {
  it("serves the OpenAPI document", async () => {
    const handler = createStudioApiHandler(baseOpts);
    const res = await handler(new Request("http://localhost/api/studio/v1/openapi.json"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STUDIO_OPENAPI);
  });

  it("401s when authorize returns false", async () => {
    const handler = createStudioApiHandler({
      ...baseOpts,
      authorize: () => false,
    });
    const res = await handler(new Request("http://localhost/api/studio/v1/branches"));
    expect(res.status).toBe(401);
  });

  it("404s unknown studio paths", async () => {
    const handler = createStudioApiHandler(baseOpts);
    const res = await handler(new Request("http://localhost/api/studio/v1/edit"));
    expect(res.status).toBe(404);
  });

  it("validates decide body", async () => {
    const handler = createStudioApiHandler(baseOpts);
    const res = await handler(
      new Request("http://localhost/api/studio/v1/approvals/abc/decide", {
        method: "POST",
        body: JSON.stringify({ decision: "maybe" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
