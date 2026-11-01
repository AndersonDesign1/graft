import { describe, expect, it } from "vitest";
import { bodyLimit, readBodyBytes, readBodyText } from "./body";

/** A body that arrives in `count` chunks of `size` bytes, recording how far it was read. */
function chunked(count: number, size: number) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled === count) return controller.close();
        pulled += 1;
        controller.enqueue(new Uint8Array(size).fill(97));
      },
      cancel() {
        cancelled = true;
      },
      // No read-ahead: a chunk is pulled only when something reads it.
    },
    { highWaterMark: 0 },
  );
  return { stream, read: () => pulled, cancelled: () => cancelled };
}

const post = (
  body: string | ReadableStream<Uint8Array> | null,
  headers: Record<string, string> = {},
) =>
  new Request("http://site.test/api/fn/x", {
    method: "POST",
    body,
    headers,
    // Node's fetch needs this for a stream body.
    duplex: "half",
  });

describe("readBodyText", () => {
  it("returns a body at or under the limit", async () => {
    expect(await readBodyText(post('{"a":1}'), 7)).toBe('{"a":1}');
    expect(await readBodyText(new Request("http://site.test/"), 10)).toBe("");
  });

  it("refuses a declared length over the limit without reading the body", async () => {
    const body = chunked(10, 100);
    await expect(
      readBodyBytes(post(body.stream, { "content-length": "1000" }), 999),
    ).rejects.toMatchObject({
      name: "GraftError",
      code: "PAYLOAD_TOO_LARGE",
      details: { limit: 999 },
    });
    expect(body.read()).toBe(0);
  });

  it("stops reading a body with no length once it passes the limit, and cancels the rest", async () => {
    const body = chunked(10, 100);
    await expect(readBodyBytes(post(body.stream), 250)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(body.read()).toBeLessThanOrEqual(4);
    expect(body.cancelled()).toBe(true);
  });

  it("names the knob that raises the limit in the fix", async () => {
    await expect(readBodyText(post("x".repeat(11)), 10)).rejects.toMatchObject({
      fix: expect.stringContaining("maxBodyBytes"),
    });
  });
});

describe("bodyLimit", () => {
  it("refuses a limit that would make every comparison false, and so disable the check", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => bodyLimit(value, 10), String(value)).toThrow(
        expect.objectContaining({ code: "CONFIG_INVALID" }),
      );
    }
    expect(bodyLimit(undefined, 10)).toBe(10);
    expect(bodyLimit(0, 10)).toBe(0);
  });

  it("is checked by the readers too, so a bad limit never reads an unbounded body", async () => {
    await expect(readBodyText(post("x"), Number.NaN)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});
