import { describe, expect, it } from "vitest";
import { withGraft } from "./next-config";

describe("withGraft", () => {
  it("injects @usegraft/registry as a server-external package", () => {
    expect(withGraft().serverExternalPackages).toEqual(["@usegraft/registry"]);
  });

  it("preserves the app's config and existing externals without duplicating", () => {
    const config = withGraft({
      reactStrictMode: true,
      serverExternalPackages: ["sharp", "@usegraft/registry"],
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.serverExternalPackages).toEqual(["sharp", "@usegraft/registry"]);
  });
});
