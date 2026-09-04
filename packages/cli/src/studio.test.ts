/**
 * Unit: the Studio preview URL — git-valid branch ids, including `@`, become
 * a loopback query; git-illegal refs stay out of execFile argv.
 */
import { GraftError } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { studioPreviewUrl } from "./commands/studio";

describe("studioPreviewUrl", () => {
  it("encodes git-valid branch names including @", () => {
    const url = new URL(studioPreviewUrl(4983, "release@2026"));
    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("4983");
    expect(url.searchParams.get("branch")).toBe("release@2026");
    expect(studioPreviewUrl(4983, "release@2026")).toContain("release%402026");
  });

  it("accepts slash segments, plus, and uppercase", () => {
    expect(new URL(studioPreviewUrl(9, "feat/nested-name")).searchParams.get("branch")).toBe(
      "feat/nested-name",
    );
    expect(new URL(studioPreviewUrl(9, "restore+5")).searchParams.get("branch")).toBe("restore+5");
    expect(new URL(studioPreviewUrl(9, "Release")).searchParams.get("branch")).toBe("Release");
  });

  it("rejects a port that did not bind", () => {
    expect(() => studioPreviewUrl(0, "main")).toThrow(GraftError);
    expect(() => studioPreviewUrl(1.5, "main")).toThrow(GraftError);
  });

  it("rejects git-illegal ref names", () => {
    for (const branch of [
      "@",
      "@{",
      "foo@{bar",
      "foo..bar",
      "foo bar",
      "foo~1",
      "foo.lock",
      ".hidden",
      "foo/",
      "/foo",
      "foo.",
      "foo//bar",
    ]) {
      expect(() => studioPreviewUrl(4983, branch), branch).toThrow(GraftError);
    }
  });
});
