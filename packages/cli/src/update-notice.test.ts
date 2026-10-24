import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";
import {
  channelOf,
  checkForUpdate,
  compareVersions,
  defaultCacheFile,
  fetchDistTags,
  formatUpdateNotice,
  newerVersion,
  updateCheckDisabled,
  useColor,
} from "./update-notice";

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.0.1", "1.0.0", 1],
    ["1.2.0", "1.10.0", -1],
    ["2.0.0", "1.99.99", 1],
    ["1.0.0", "1.0.0-beta.9", 1],
    ["1.0.0-beta.10", "1.0.0-beta.9", 1],
    ["1.0.0-beta.9", "1.0.0-beta.10", -1],
    ["1.0.0-beta", "1.0.0-beta.1", -1],
    ["1.0.0-alpha.1", "1.0.0-beta.1", -1],
    ["1.0.0-1", "1.0.0-beta", -1],
    ["1.0.0+build.5", "1.0.0", 0],
  ])("%s vs %s is %d", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it("returns undefined for something that is not a version", () => {
    expect(compareVersions("latest", "1.0.0")).toBeUndefined();
  });
});

describe("channelOf", () => {
  it.each([
    ["1.0.0-beta.8", "beta"],
    ["1.0.0-rc.1", "rc"],
    ["1.2.3", "latest"],
    ["0.0.0-canary-20260901211203", undefined],
    ["1.0.0-0", undefined],
    ["nonsense", undefined],
  ])("%s is on %s", (version, channel) => {
    expect(channelOf(version)).toBe(channel);
  });
});

describe("newerVersion", () => {
  it("offers the newer beta to a beta install, as a security notice", () => {
    expect(newerVersion("1.0.0-beta.8", { beta: "1.0.0-beta.9", latest: "1.0.0-beta.8" })).toEqual({
      current: "1.0.0-beta.8",
      latest: "1.0.0-beta.9",
      level: "security",
    });
  });

  it("offers a stable release to a beta install once it ships", () => {
    expect(newerVersion("1.0.0-beta.12", { beta: "1.0.0-beta.12", latest: "1.0.0" })?.latest).toBe(
      "1.0.0",
    );
  });

  it("offers latest to a stable install, as information", () => {
    expect(newerVersion("1.0.0", { latest: "1.1.0", beta: "1.2.0-beta.1" })).toEqual({
      current: "1.0.0",
      latest: "1.1.0",
      level: "info",
    });
  });

  it("says nothing when the install is current or ahead", () => {
    expect(newerVersion("1.0.0-beta.8", { beta: "1.0.0-beta.8" })).toBeUndefined();
    expect(newerVersion("1.0.0-beta.9", { beta: "1.0.0-beta.8" })).toBeUndefined();
    expect(newerVersion("1.0.0-beta.8", {})).toBeUndefined();
  });

  it("says nothing to a canary", () => {
    expect(newerVersion("0.0.0-canary-1", { latest: "1.0.0" })).toBeUndefined();
  });
});

describe("updateCheckDisabled", () => {
  it("is off under CI, VITEST and GRAFT_NO_UPDATE_CHECK", () => {
    expect(updateCheckDisabled({})).toBe(false);
    expect(updateCheckDisabled({ CI: "true" })).toBe(true);
    expect(updateCheckDisabled({ VITEST: "true" })).toBe(true);
    expect(updateCheckDisabled({ GRAFT_NO_UPDATE_CHECK: "1" })).toBe(true);
  });

  it("reads GRAFT_NO_UPDATE_CHECK from the project's .env, without loading the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-update-env-"));
    try {
      const nested = join(dir, "site", "content");
      mkdirSync(nested, { recursive: true });
      expect(updateCheckDisabled({}, nested)).toBe(false);
      writeFileSync(join(dir, ".env"), "DATABASE_URL=postgres://x\nGRAFT_NO_UPDATE_CHECK=1\n");
      expect(updateCheckDisabled({}, nested)).toBe(true);
      expect(process.env.DATABASE_URL).not.toBe("postgres://x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkForUpdate", () => {
  let dir: string;
  let cacheFile: string;
  const now = Date.parse("2026-10-24T12:00:00Z");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graft-update-"));
    cacheFile = join(dir, "nested", "update-check.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("asks the registry, then answers from the cache for a day", async () => {
    const fetchTags = vi.fn(async () => ({ beta: "1.0.0-beta.9" }));
    const options = { current: "1.0.0-beta.8", env: {}, cacheFile, fetchTags };

    expect((await checkForUpdate({ ...options, now }))?.latest).toBe("1.0.0-beta.9");
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toEqual({
      checkedAt: now,
      registry: "https://registry.npmjs.org",
      tags: { beta: "1.0.0-beta.9" },
    });
    expect((await checkForUpdate({ ...options, now: now + 60_000 }))?.latest).toBe("1.0.0-beta.9");
    expect(fetchTags).toHaveBeenCalledTimes(1);

    await checkForUpdate({ ...options, now: now + 25 * 60 * 60 * 1000 });
    expect(fetchTags).toHaveBeenCalledTimes(2);
  });

  it("caches a failed request, so an offline machine is not slowed every run", async () => {
    const fetchTags = vi.fn(async () => {
      throw new Error("offline");
    });
    const options = { current: "1.0.0-beta.8", env: {}, cacheFile, fetchTags };
    expect(await checkForUpdate({ ...options, now })).toBeUndefined();
    expect(await checkForUpdate({ ...options, now: now + 1000 })).toBeUndefined();
    expect(fetchTags).toHaveBeenCalledTimes(1);
  });

  it("ignores a corrupt cache file", async () => {
    const file = join(dir, "update-check.json");
    writeFileSync(file, "{not json");
    const fetchTags = vi.fn(async () => ({ beta: "1.0.0-beta.9" }));
    const notice = await checkForUpdate({
      current: "1.0.0-beta.8",
      env: {},
      cacheFile: file,
      fetchTags,
      now,
    });
    expect(notice?.latest).toBe("1.0.0-beta.9");
  });

  it("asks again when npm_config_registry points somewhere else", async () => {
    const fetchTags = vi.fn(async () => ({ beta: "1.0.0-beta.9" }));
    const options = { current: "1.0.0-beta.8", cacheFile, fetchTags, now };
    await checkForUpdate({ ...options, env: {} });
    await checkForUpdate({ ...options, env: { npm_config_registry: "https://npm.example.com/" } });
    expect(fetchTags).toHaveBeenCalledTimes(2);
    await checkForUpdate({ ...options, env: { npm_config_registry: "https://npm.example.com" } });
    expect(fetchTags).toHaveBeenCalledTimes(2);
  });

  it("never asks the registry for a canary", async () => {
    const fetchTags = vi.fn(async () => ({ latest: "1.0.0" }));
    await checkForUpdate({ current: "0.0.0-canary-1", env: {}, cacheFile, fetchTags, now });
    expect(fetchTags).not.toHaveBeenCalled();
  });

  it("keeps the cache under XDG_CACHE_HOME when it is set", () => {
    expect(defaultCacheFile({ XDG_CACHE_HOME: "/x" })).toBe(
      join("/x", "graft", "update-check.json"),
    );
  });
});

describe("fetchDistTags", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks npm_config_registry for the encoded package name and keeps only string tags", async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json({ beta: "1.0.0-beta.9", latest: "1.0.0-beta.8", bogus: 3 }),
    );
    vi.stubGlobal("fetch", fetch);
    const tags = await fetchDistTags({ npm_config_registry: "https://registry.example.com/" });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://registry.example.com/-/package/%40usegraft%2Fcli/dist-tags",
    );
    expect(tags).toEqual({ beta: "1.0.0-beta.9", latest: "1.0.0-beta.8" });
  });

  it("throws on a registry error, which checkForUpdate turns into no notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(fetchDistTags({})).rejects.toThrow("503");
  });
});

describe("formatUpdateNotice", () => {
  const security = { current: "1.0.0-beta.8", latest: "1.0.0-beta.9", level: "security" } as const;

  it("names both versions, the upgrade guide and how to hide it", () => {
    const text = formatUpdateNotice(security, false);
    expect(text).toContain("Graft 1.0.0-beta.9 is available. You have 1.0.0-beta.8.");
    expect(text).toContain("security fixes");
    expect(text).toContain("https://graft.page/docs/upgrading");
    expect(text).toContain("GRAFT_NO_UPDATE_CHECK=1");
    expect(text).not.toContain("\u001b[");
    expect(text).not.toContain("—");
  });

  it("is yellow for a security upgrade and cyan for an ordinary one", () => {
    expect(formatUpdateNotice(security, true)).toContain("\u001b[33m");
    const info = formatUpdateNotice({ current: "1.0.0", latest: "1.1.0", level: "info" }, true);
    expect(info).toContain("\u001b[36m");
    expect(info).not.toContain("security fixes");
  });

  it("uses color only on a terminal without NO_COLOR", () => {
    expect(useColor({}, true)).toBe(true);
    expect(useColor({}, false)).toBe(false);
    expect(useColor({ NO_COLOR: "1" }, true)).toBe(false);
  });
});

describe("run prints the notice", () => {
  let errors: string[];
  let logs: string[];

  beforeEach(() => {
    errors = [];
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("on stderr after a one-shot command's own output", async () => {
    const order: string[] = [];
    vi.mocked(console.log).mockImplementation(() => order.push("out"));
    vi.mocked(console.error).mockImplementation(() => order.push("notice"));
    const code = await run(["frobnicate"], { updateNotice: async () => "NOTICE" });
    expect(code).toBe(1);
    expect(order.at(-1)).toBe("notice");
  });

  it("not for --version or --help", async () => {
    const updateNotice = vi.fn(async () => "NOTICE");
    await run(["--version"], { updateNotice });
    await run(["compile", "--help"], { updateNotice });
    await run([], { updateNotice });
    expect(updateNotice).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("not when the check fails", async () => {
    await run(["frobnicate"], {
      updateNotice: async () => {
        throw new Error("boom");
      },
    });
    expect(errors.join("\n")).not.toContain("boom");
  });
});
