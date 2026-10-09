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

describe("graft studio invite", () => {
  const secret = "k".repeat(40);

  it("prints a link the hosted Studio accepts", async () => {
    const { studioInviteCommand } = await import("./commands/studio");
    const { createStudioHandler } = await import("@usegraft/studio");
    const previous = process.env.GRAFT_STUDIO_SECRET;
    process.env.GRAFT_STUDIO_SECRET = secret;
    try {
      const invite = await studioInviteCommand({
        cwd: process.cwd(),
        email: "ana@shop.test",
        role: "contributor",
        url: "https://shop.test/",
      });
      expect(invite.url).toMatch(/^https:\/\/shop\.test\/api\/studio\/v1\/auth\/link\?token=/);
      const handler = createStudioHandler({
        db: {} as never,
        collections: {},
        contentDir: "/tmp/none",
        uiBasePath: "/studio",
        editors: { secret },
      });
      const response = await handler(new Request(invite.url, { redirect: "manual" }));
      expect(response.headers.get("location")).toBe("/studio/");
      expect(response.headers.getSetCookie().join()).toContain("graft_studio=");
    } finally {
      if (previous === undefined) delete process.env.GRAFT_STUDIO_SECRET;
      else process.env.GRAFT_STUDIO_SECRET = previous;
    }
  });

  it("refuses an unknown role and a missing URL", async () => {
    const { studioInviteCommand } = await import("./commands/studio");
    await expect(
      studioInviteCommand({ cwd: process.cwd(), email: "a@b.c", role: "owner", url: "https://x" }),
    ).rejects.toThrow(/not a Studio role/);
    const saved = process.env.GRAFT_STUDIO_URL;
    delete process.env.GRAFT_STUDIO_URL;
    await expect(studioInviteCommand({ cwd: process.cwd(), email: "a@b.c" })).rejects.toThrow(
      /public URL/,
    );
    if (saved !== undefined) process.env.GRAFT_STUDIO_URL = saved;
  });
});
