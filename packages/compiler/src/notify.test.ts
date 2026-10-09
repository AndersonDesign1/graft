import { GraftError, type ChangeSet } from "@usegraft/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRevalidateWebhook,
  hasContentChanges,
  notifyContentChange,
  revalidateWebhookFromEnv,
  type ContentChangeEvent,
} from "./notify";

const changed: ChangeSet = { added: [], changed: ["pages/home"], removed: [], unchanged: 3 };
const unchanged: ChangeSet = { added: [], changed: [], removed: [], unchanged: 4 };
const event: ContentChangeEvent = { branch: "main", gitSha: "abc123", changes: changed };

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fetch double that records what it was sent and answers `response`. */
function fakeFetch(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { fn, calls };
}

describe("hasContentChanges", () => {
  it("is false when a compile changed nothing", () => {
    expect(hasContentChanges(unchanged)).toBe(false);
  });

  it("is true for any added, changed or removed document", () => {
    expect(hasContentChanges(changed)).toBe(true);
    expect(hasContentChanges({ ...unchanged, removed: ["pages/old"] })).toBe(true);
    expect(hasContentChanges({ ...unchanged, added: ["pages/new"] })).toBe(true);
  });
});

describe("notifyContentChange", () => {
  it("does nothing without a listener", async () => {
    expect(await notifyContentChange(undefined, event)).toBeUndefined();
  });

  it("does not call the listener when nothing changed", async () => {
    const listener = vi.fn();
    expect(await notifyContentChange(listener, { ...event, changes: unchanged })).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("passes the event to the listener and reports ok", async () => {
    const listener = vi.fn();
    expect(await notifyContentChange(listener, event)).toEqual({ ok: true });
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("reports a throwing listener instead of throwing, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const notice = await notifyContentChange(() => {
      throw new Error("boom");
    }, event);
    expect(notice).toMatchObject({ ok: false, error: "REVALIDATE_FAILED" });
    expect(notice && !notice.ok && notice.message).toContain("boom");
    expect(notice && !notice.ok && notice.fix).toBeTruthy();
    expect(log).toHaveBeenCalledOnce();
    // A later compile reports these documents unchanged, so the logged event
    // is the only record of what to resend.
    expect(String(log.mock.calls[0]?.[0])).toContain(`resend: ${JSON.stringify(event)}`);
    expect(notice && !notice.ok && notice.fix).toContain("will not refresh them");
  });

  it("keeps a GraftError's own code and fix", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notice = await notifyContentChange(async () => {
      throw new GraftError({ code: "UNAUTHORIZED", message: "no", fix: "set the secret" });
    }, event);
    expect(notice).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
      message: "no",
      fix: "set the secret",
    });
  });
});

describe("createRevalidateWebhook", () => {
  it("POSTs { branch, gitSha, changes } with the bearer secret and no redirects", async () => {
    const { fn, calls } = fakeFetch(new Response(null, { status: 200 }));
    const hook = createRevalidateWebhook({
      url: "https://example.com/api/revalidate",
      secret: "s3cret",
      fetch: fn,
    });
    await hook(event);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://example.com/api/revalidate");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.headers).toMatchObject({
      authorization: "Bearer s3cret",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      branch: "main",
      gitSha: "abc123",
      changes: changed,
    });
  });

  it("names the secret when the route answers 401", async () => {
    const { fn } = fakeFetch(new Response('{"error":"Unauthorized"}', { status: 401 }));
    const hook = createRevalidateWebhook({ url: "https://example.com/r", secret: "x", fetch: fn });
    const error = await Promise.resolve(hook(event)).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "REVALIDATE_FAILED", details: { status: 401 } });
    expect((error as GraftError).fix).toContain("GRAFT_WEBHOOK_SECRET");
  });

  it("names the route on any other error status", async () => {
    const { fn } = fakeFetch(new Response("nope", { status: 500 }));
    const hook = createRevalidateWebhook({ url: "https://example.com/r", secret: "x", fetch: fn });
    const error = await Promise.resolve(hook(event)).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "REVALIDATE_FAILED", details: { status: 500 } });
    expect((error as GraftError).message).toContain("nope");
  });

  it("turns a network failure into REVALIDATE_FAILED", async () => {
    const { fn } = fakeFetch(new TypeError("fetch failed"));
    const hook = createRevalidateWebhook({ url: "https://example.com/r", secret: "x", fetch: fn });
    const error = await Promise.resolve(hook(event)).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "REVALIDATE_FAILED" });
    expect((error as GraftError).message).toContain("fetch failed");
  });

  it("refuses plain http to anything but loopback", () => {
    expect(() => createRevalidateWebhook({ url: "http://example.com/r", secret: "x" })).toThrow(
      expect.objectContaining({ code: "INPUT_VALIDATION_FAILED" }),
    );
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(() => createRevalidateWebhook({ url: `http://${host}/r`, secret: "x" })).not.toThrow();
    }
  });

  it("refuses a value that is not a URL, or an empty secret", () => {
    expect(() => createRevalidateWebhook({ url: "example.com/r", secret: "x" })).toThrow(
      expect.objectContaining({ code: "INPUT_VALIDATION_FAILED" }),
    );
    expect(() => createRevalidateWebhook({ url: "https://example.com/r", secret: "" })).toThrow(
      expect.objectContaining({ code: "ENV_VAR_MISSING" }),
    );
  });
});

describe("revalidateWebhookFromEnv", () => {
  it("is off when GRAFT_REVALIDATE_URL is unset or blank", () => {
    expect(revalidateWebhookFromEnv({})).toBeUndefined();
    expect(revalidateWebhookFromEnv({ GRAFT_REVALIDATE_URL: "  " })).toBeUndefined();
  });

  it("refuses a URL without a secret, so a server never starts half-configured", () => {
    expect(() =>
      revalidateWebhookFromEnv({ GRAFT_REVALIDATE_URL: "https://example.com/r" }),
    ).toThrow(expect.objectContaining({ code: "ENV_VAR_MISSING" }));
  });

  it("builds a listener from both variables", () => {
    const listener = revalidateWebhookFromEnv({
      GRAFT_REVALIDATE_URL: "https://example.com/r",
      GRAFT_WEBHOOK_SECRET: "x",
    });
    expect(typeof listener).toBe("function");
  });
});
