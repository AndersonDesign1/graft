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

  it("401s when authenticate refuses the request", async () => {
    const handler = createStudioApiHandler({ ...baseOpts, authenticate: () => null });
    const res = await handler(new Request("http://localhost/api/studio/v1/branches"));
    expect(res.status).toBe(401);
  });

  it("401s an authenticated caller whose credential lacks the route's scope", async () => {
    // The whole point: authenticated is not authorized. `graft serve` used to
    // admit anyone whose kind !== "anonymous", which is every agent.
    const handler = createStudioApiHandler({
      ...baseOpts,
      authenticate: () => ({ kind: "agent", id: "agent-1", scopes: ["studio:read"] }),
    });
    const res = await handler(
      new Request("http://localhost/api/studio/v1/changes/commit", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ details: { required: "studio:write" } });
  });

  it("separates deciding approvals from writing content", async () => {
    // A credential that may commit content still may not decide the human gate.
    const handler = createStudioApiHandler({
      ...baseOpts,
      authenticate: () => ({
        kind: "agent",
        id: "agent-1",
        scopes: ["studio:read", "studio:write"],
      }),
    });
    const res = await handler(
      new Request("http://localhost/api/studio/v1/approvals/abc/decide", {
        method: "POST",
        body: JSON.stringify({ decision: "approved" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ details: { required: "approvals:decide" } });
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
