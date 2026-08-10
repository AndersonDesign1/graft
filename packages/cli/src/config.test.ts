import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { findConfig, loadConfig, requireDatabaseUrl } from "./config";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = resolve(here, "../test/fixtures");

function graftErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof GraftError) return error.code;
    throw error;
  }
  throw new Error("expected a GraftError");
}

async function graftErrorCodeAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof GraftError) return error.code;
    throw error;
  }
  throw new Error("expected a GraftError");
}

describe("findConfig", () => {
  it("finds graft.config.ts in the starting directory", () => {
    expect(findConfig(join(fixtures, "basic"))).toBe(join(fixtures, "basic", "graft.config.ts"));
  });

  it("walks up from a nested directory", () => {
    expect(findConfig(join(fixtures, "basic", "content", "pages"))).toBe(
      join(fixtures, "basic", "graft.config.ts"),
    );
  });

  it("throws CONFIG_NOT_FOUND with a fix when no config exists", () => {
    expect(graftErrorCode(() => findConfig(tmpdir()))).toBe("CONFIG_NOT_FOUND");
  });
});

describe("loadConfig", () => {
  it("loads collections and defaults contentDir to <project>/content", async () => {
    const config = await loadConfig(join(fixtures, "basic", "graft.config.ts"));
    expect(Object.keys(config.collections)).toEqual(["pages"]);
    expect(config.collections.pages?.name).toBe("pages");
    expect(config.projectDir).toBe(join(fixtures, "basic"));
    expect(config.contentDir).toBe(join(fixtures, "basic", "content"));
    expect(config.functions).toEqual({});
  });

  it("respects an exported contentDir", async () => {
    const config = await loadConfig(join(fixtures, "custom-dir", "graft.config.ts"));
    expect(config.contentDir).toBe(join(fixtures, "custom-dir", "docs"));
  });

  it("rejects a config whose collections are not defineCollection results", async () => {
    expect(
      await graftErrorCodeAsync(() => loadConfig(join(fixtures, "invalid", "graft.config.ts"))),
    ).toBe("CONFIG_INVALID");
  });

  it("rejects a config that throws at import time", async () => {
    expect(
      await graftErrorCodeAsync(() => loadConfig(join(fixtures, "broken", "graft.config.ts"))),
    ).toBe("CONFIG_INVALID");
  });
});

describe("index config", () => {
  it("defaults to postgres when the config omits `index`", async () => {
    const config = await loadConfig(findConfig(join(fixtures, "basic")));
    expect(config.index).toEqual({ driver: "postgres" });
  });

  it('resolves `index = "static"` to the default artifact path', async () => {
    const dir = join(fixtures, "static-basic");
    const config = await loadConfig(findConfig(dir));
    expect(config.index).toEqual({ driver: "static", path: join(dir, ".graft", "index.db") });
  });

  it("refuses a static project that declares functions or db-authoritative collections", async () => {
    const load = () => loadConfig(findConfig(join(fixtures, "static-with-functions")));
    expect(await graftErrorCodeAsync(load)).toBe("NEEDS_DATABASE");
    // The message must name what forced the upgrade, and the fix the order to do it in.
    const error = (await load().catch((e: unknown) => e)) as GraftError;
    expect(error.message).toContain('"orders"');
    expect(error.message).toContain('"countPages"');
    expect(error.fix).toContain("graft db migrate");
  });
});

describe("requireDatabaseUrl", () => {
  it("throws ENV_VAR_MISSING when DATABASE_URL is unset", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(graftErrorCode(() => requireDatabaseUrl())).toBe("ENV_VAR_MISSING");
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
    }
  });

  it("returns the value when set", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://example";
    try {
      expect(requireDatabaseUrl()).toBe("postgres://example");
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
