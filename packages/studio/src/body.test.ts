import { describe, expect, it } from "vitest";
import { readJson } from "./body";

describe("readJson", () => {
  it("answers a body that cannot be read the same as one that is not JSON: null", async () => {
    // A client gone mid-body makes the stream error. Each route answers null
    // with its own 400, as it did when routes called request.json() directly.
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error("socket hang up"));
      },
    });
    const request = new Request("http://studio.test/x", {
      method: "POST",
      body: broken,
      // @ts-expect-error Node's fetch needs this for a stream body; Studio's DOM types omit it.
      duplex: "half",
    });
    expect(await readJson(request)).toBeNull();
    expect(
      await readJson(new Request("http://studio.test/x", { method: "POST", body: "{no" })),
    ).toBeNull();
  });

  it("still refuses a body over the limit", async () => {
    await expect(
      readJson(new Request("http://studio.test/x", { method: "POST", body: "x".repeat(20) }), 10),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});
