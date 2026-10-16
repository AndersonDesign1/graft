import { afterEach, describe, expect, it, vi } from "vitest";
import { nextVersionAdvice, withGraft } from "./next-config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withGraft", () => {
  it("injects @usegraft/registry as a server-external package", () => {
    expect(withGraft({}, { nextVersion: "16.3.8" }).serverExternalPackages).toEqual([
      "@usegraft/registry",
    ]);
  });

  it("preserves the app's config and existing externals without duplicating", () => {
    const config = withGraft(
      { reactStrictMode: true, serverExternalPackages: ["sharp", "@usegraft/registry"] },
      { nextVersion: "15.5.27" },
    );
    expect(config.reactStrictMode).toBe(true);
    expect(config.serverExternalPackages).toEqual(["sharp", "@usegraft/registry"]);
  });

  it("writes Next.js 14's experimental key there, keeping the app's other settings", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = withGraft(
      { reactStrictMode: true, experimental: { typedRoutes: true } },
      { nextVersion: "14.2.35" },
    );
    expect(config).toEqual({
      reactStrictMode: true,
      experimental: { typedRoutes: true, serverComponentsExternalPackages: ["@usegraft/registry"] },
    });
    expect(config).not.toHaveProperty("serverExternalPackages");
  });

  it("writes the current key when the version can't be read", () => {
    expect(withGraft({}, { nextVersion: "not-a-version" }).serverExternalPackages).toEqual([
      "@usegraft/registry",
    ]);
  });
});

describe("nextVersionAdvice", () => {
  it("is silent from the patched releases on", () => {
    expect(nextVersionAdvice("15.5.24")).toBeNull();
    expect(nextVersionAdvice("15.6.0")).toBeNull();
    expect(nextVersionAdvice("16.3.3")).toBeNull();
    expect(nextVersionAdvice("17.0.0")).toBeNull();
  });

  it("names the release to upgrade to below them", () => {
    expect(nextVersionAdvice("15.5.23")).toBe(
      "Next.js 15.5.23 has known critical security advisories. Upgrade to 15.5.24 or later.",
    );
    expect(nextVersionAdvice("16.2.9")).toContain("Upgrade to 16.3.3 or later.");
    expect(nextVersionAdvice("14.2.35")).toContain("Next.js 14 no longer gets security fixes");
  });

  it("says what is supported below 14.2", () => {
    expect(nextVersionAdvice("14.1.4")).toBe(
      "Graft supports Next.js 14.2 and later. This app has 14.1.4.",
    );
  });
});
