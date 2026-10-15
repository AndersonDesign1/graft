/**
 * What `graft doctor` and setup_status say to do next. The checks themselves
 * reach a database; choosing among them does not.
 */
import { describe, expect, it } from "vitest";
import { formatSetupStatus, nextStep, type SetupCheck } from "./setup-status";

const pass = (id: string): SetupCheck => ({ id, state: "pass", title: id, detail: "Fine." });
const studioSecret: SetupCheck = {
  id: "studio-secret",
  state: "warn",
  title: "Studio sign-in",
  detail: "GRAFT_STUDIO_SECRET is not set.",
  fix: "Add GRAFT_STUDIO_SECRET to .env.",
};

describe("nextStep", () => {
  it("never makes a missing Studio secret the next step", () => {
    expect(nextStep([pass("database"), pass("index"), studioSecret])).toBeNull();
  });

  it("makes the owner account next once the secret is set", () => {
    const owner: SetupCheck = {
      id: "studio",
      state: "warn",
      title: "Studio sign-in",
      detail: "Nobody has a Studio account yet.",
      fix: "Open /studio with the code `graft studio setup-code` prints.",
    };
    expect(nextStep([pass("database"), owner])).toContain("graft studio setup-code");
  });

  it("still takes a failure first, and a warning about this computer", () => {
    const pooled: SetupCheck = {
      id: "database-pooled",
      state: "warn",
      title: "Database",
      detail: "Pooled.",
      fix: "Use the direct URL.",
    };
    const index: SetupCheck = {
      id: "index",
      state: "fail",
      title: "Index",
      detail: "Missing.",
      fix: "Run `graft compile`.",
    };
    expect(nextStep([studioSecret, pooled, index])).toBe("Run `graft compile`.");
    expect(nextStep([studioSecret, pooled])).toBe("Use the direct URL.");
  });
});

describe("formatSetupStatus", () => {
  it("says what is ready here, and that the warnings are for going online", () => {
    const checks = [pass("database"), studioSecret];
    const text = formatSetupStatus({ ready: true, checks, next: nextStep(checks) });
    expect(text).not.toContain("Next:");
    expect(text).toContain("Ready to work on this computer");
    expect(text).toContain("The ! lines matter when you put the site online.");
  });

  it("says everything is set up only when nothing warns", () => {
    const checks = [pass("database")];
    expect(formatSetupStatus({ ready: true, checks, next: null })).toContain(
      "Everything is set up.",
    );
  });
});
