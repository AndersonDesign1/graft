import { GraftError } from "@usegraft/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actorOptions } from "./actor";
import { lazyHandler } from "./handler";

const request = () => new Request("http://site.test/api/fn/x", { method: "POST" });

describe("lazyHandler", () => {
  it("builds once and reuses the handler", async () => {
    const build = vi.fn(async () => async () => new Response("ok"));
    const handler = lazyHandler(build);

    expect(await (await handler(request())).text()).toBe("ok");
    expect(await (await handler(request())).text()).toBe("ok");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("answers a configuration failure as 503 GraftError JSON, then retries the build", async () => {
    let configured = false;
    const handler = lazyHandler(async () => {
      if (!configured) {
        throw new GraftError({
          code: "CONFIG_INVALID",
          message: "No database.",
          fix: "Set one.",
        });
      }
      return async () => new Response("ok");
    });

    const refused = await handler(request());
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({
      error: "CONFIG_INVALID",
      fix: "Set one.",
    });

    configured = true;
    expect(await (await handler(request())).text()).toBe("ok");
  });

  it("lets an unexpected failure through instead of dressing it up as configuration", async () => {
    const handler = lazyHandler(async () => {
      throw new TypeError("bug");
    });
    await expect(handler(request())).rejects.toThrow("bug");
  });
});

describe("actorOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("checks a numeric audience, which Nuxt hands over as a number", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      actorOptions({
        trustedIssuers: "https://a.test",
        trustedAudience: 123456,
      }),
    ).toEqual({
      issuers: [{ issuer: "https://a.test", actorKind: "agent", audience: ["123456"] }],
      devTokens: undefined,
    });
  });

  it("splits trusted issuers on commas and spaces", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      actorOptions({
        trustedIssuers: "https://a.test, https://b.test  https://c.test",
      }),
    ).toEqual({
      issuers: [
        { issuer: "https://a.test", actorKind: "agent" },
        { issuer: "https://b.test", actorKind: "agent" },
        { issuer: "https://c.test", actorKind: "agent" },
      ],
      devTokens: undefined,
    });
  });

  it("accepts the dev token in development only, and never an empty one", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(actorOptions({ devToken: "secret" }).devTokens).toEqual({
      secret: { kind: "human", id: "owner", scopes: ["content:write"] },
    });
    expect(actorOptions({ devToken: "" }).devTokens).toBeUndefined();

    vi.stubEnv("NODE_ENV", "production");
    expect(actorOptions({ devToken: "secret" }).devTokens).toBeUndefined();
    vi.stubEnv("NODE_ENV", "");
    expect(actorOptions({ devToken: "secret" }).devTokens).toBeUndefined();
  });
});
