import { describe, expect, it } from "vitest";
import { engineFor } from "./engine";

const cwd = "/srv/site";

describe("engineFor", () => {
  it("opens the static index at the default path, relative to the server's directory", () => {
    expect(engineFor("static", {}, {}, cwd)).toEqual({
      kind: "static",
      path: "/srv/site/.graft/index.db",
    });
  });

  it("takes the config's own path, and lets the runtime config's staticIndex override it", () => {
    const index = { driver: "static", path: "build/content.db" };
    expect(engineFor(index, {}, {}, cwd)).toEqual({
      kind: "static",
      path: "/srv/site/build/content.db",
    });
    expect(engineFor(index, { staticIndex: "/data/index.db" }, {}, cwd)).toEqual({
      kind: "static",
      path: "/data/index.db",
    });
  });

  it("reads Postgres from NUXT_GRAFT_DATABASE_URL first, then DATABASE_URL, when index is omitted", () => {
    const env = { DATABASE_URL: "postgres://env" };
    expect(engineFor(undefined, { databaseUrl: "postgres://runtime" }, env, cwd)).toEqual({
      kind: "postgres",
      url: "postgres://runtime",
    });
    expect(engineFor("postgres", { databaseUrl: "" }, env, cwd)).toEqual({
      kind: "postgres",
      url: "postgres://env",
    });
    expect(engineFor({ driver: "postgres" }, {}, env, cwd)).toEqual({
      kind: "postgres",
      url: "postgres://env",
    });
  });

  it("refuses Postgres with no database URL, naming both ways out", () => {
    expect(() => engineFor("postgres", {}, {}, cwd)).toThrowError(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        fix: expect.stringMatching(/NUXT_GRAFT_DATABASE_URL.*index = "static"/s),
      }),
    );
  });

  it("refuses an index setting it does not know, rather than guessing an engine", () => {
    for (const index of [
      "sqlite",
      { driver: "mongo" },
      { driver: "static", path: 3 },
      ["static"],
    ]) {
      expect(() => engineFor(index, { databaseUrl: "postgres://x" }, {}, cwd)).toThrowError(
        expect.objectContaining({ code: "CONFIG_INVALID", details: { index } }),
      );
    }
  });
});
