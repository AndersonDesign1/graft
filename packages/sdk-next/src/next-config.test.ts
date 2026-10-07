import { afterEach, describe, expect, it, vi } from "vitest";

// withGraft reads next/package.json to pick the externals key. The fake lets
// one run cover every major. `undefined` falls through to the Next actually
// installed, which is what the CI version matrix changes.
let fakeNextVersion: string | null | undefined;

const installed = vi.hoisted(() => ({ version: "" }));

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  const manifest: { version: string } = actual.createRequire(import.meta.url)("next/package.json");
  installed.version = manifest.version;
  return {
    ...actual,
    createRequire: (base: string | URL) => {
      const real = actual.createRequire(base);
      return Object.assign((id: string) => {
        if (id !== "next/package.json" || fakeNextVersion === undefined) return real(id);
        if (fakeNextVersion === null) throw new Error("Cannot find module 'next/package.json'");
        return { version: fakeNextVersion };
      }, real);
    },
  };
});

const { withGraft } = await import("./next-config");

afterEach(() => {
  fakeNextVersion = undefined;
});

describe("withGraft on Next 15 and later", () => {
  it.each(["15.5.27", "16.4.0"])(
    "injects @usegraft/registry into serverExternalPackages (%s)",
    (v) => {
      fakeNextVersion = v;
      const config = withGraft();
      expect(config.serverExternalPackages).toEqual(["@usegraft/registry"]);
      expect(config.experimental).toBeUndefined();
    },
  );

  it("preserves the app's config and existing externals without duplicating", () => {
    fakeNextVersion = "16.4.0";
    const config = withGraft({
      reactStrictMode: true,
      serverExternalPackages: ["sharp", "@usegraft/registry"],
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.serverExternalPackages).toEqual(["sharp", "@usegraft/registry"]);
  });

  it("uses the current key when the installed version cannot be found", () => {
    fakeNextVersion = null;
    expect(withGraft().serverExternalPackages).toEqual(["@usegraft/registry"]);
  });
});

describe("withGraft on Next 14", () => {
  it("injects @usegraft/registry into experimental.serverComponentsExternalPackages", () => {
    fakeNextVersion = "14.2.35";
    const config = withGraft();
    expect(config.experimental?.serverComponentsExternalPackages).toEqual(["@usegraft/registry"]);
    // Next 14 rejects the newer key as unrecognized.
    expect(config.serverExternalPackages).toBeUndefined();
  });

  it("keeps other experimental options and existing externals without duplicating", () => {
    fakeNextVersion = "14.2.35";
    const config = withGraft({
      reactStrictMode: true,
      experimental: {
        optimizePackageImports: ["lodash"],
        serverComponentsExternalPackages: ["sharp", "@usegraft/registry"],
      },
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.experimental?.optimizePackageImports).toEqual(["lodash"]);
    expect(config.experimental?.serverComponentsExternalPackages).toEqual([
      "sharp",
      "@usegraft/registry",
    ]);
  });
});

describe("withGraft against the Next installed here", () => {
  it("sets the key that version reads", () => {
    const config = withGraft();
    if (Number.parseInt(installed.version, 10) < 15) {
      expect(config.experimental?.serverComponentsExternalPackages).toContain("@usegraft/registry");
      expect(config.serverExternalPackages).toBeUndefined();
    } else {
      expect(config.serverExternalPackages).toContain("@usegraft/registry");
    }
  });
});
