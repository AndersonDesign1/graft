import { describe, expect, it } from "vitest";
import { scaffoldFiles, type ScaffoldOptions } from "./scaffold";

const base: ScaffoldOptions = {
  name: "site",
  template: "blog",
  framework: "sveltekit",
  source: "git",
  index: "static",
  graftVersion: "1.0.0",
};

describe("the SvelteKit site", () => {
  it("reads the static index with no environment to declare", () => {
    const files = scaffoldFiles(base);
    expect(files["src/lib/server/graft.ts"]).toContain("openStaticIndex");
    expect(files["src/env.ts"]).toBeUndefined();
  });

  it("on Postgres, declares DATABASE_URL the way SvelteKit 3 reads it", () => {
    const files = scaffoldFiles({ ...base, source: "database", index: "postgres" });
    // SvelteKit 3 removed $env/static/private: variables come from src/env.ts.
    expect(files["src/lib/server/graft.ts"]).toContain('from "$app/env/private"');
    expect(files["src/lib/server/graft.ts"]).not.toContain("$env/");
    expect(files["src/env.ts"]).toContain("defineEnvVars");
    expect(files["src/env.ts"]).toContain("DATABASE_URL");
  });

  it("imports through #lib, since SvelteKit 3 has no $lib", () => {
    const sources = Object.entries(scaffoldFiles(base))
      .filter(([path]) => path.startsWith("src/"))
      .map(([, body]) => body)
      .join("\n");
    expect(sources).toContain("#lib/");
    expect(sources).not.toContain("$lib");
  });
});
