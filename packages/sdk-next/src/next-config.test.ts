import { describe, expect, it } from "vitest";
import { withGraft } from "./next-config";

describe("withGraft", () => {
  it("injects @graft/registry as a server-external package", () => {
    expect(withGraft().serverExternalPackages).toEqual(["@graft/registry"]);
  });

  it("preserves the app's config and existing externals without duplicating", () => {
    const config = withGraft({
      reactStrictMode: true,
      serverExternalPackages: ["sharp", "@graft/registry"],
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.serverExternalPackages).toEqual(["sharp", "@graft/registry"]);
  });
});
