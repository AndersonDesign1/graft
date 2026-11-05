import { describe, expect, it } from "vitest";
import { SITE_FRAMEWORKS } from "../registry";
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

describe("the dev script", () => {
  it("runs the site's dev server under graft dev, so content edits recompile", () => {
    for (const [framework, dev] of [
      ["next", "graft dev -- next dev"],
      ["nuxt", "graft dev -- nuxt dev"],
      ["sveltekit", "graft dev -- vite dev --port 3000"],
      // Astro 7 moves astro dev to the background when an agent runs it, unless --ignore-lock.
      ["astro", "graft dev -- astro dev --ignore-lock"],
      ["react-router", "graft dev -- react-router dev --port 3000"],
      ["tanstack-start", "graft dev -- vite dev --port 3000"],
    ] as const) {
      const files = scaffoldFiles({ ...base, framework });
      expect(JSON.parse(files["package.json"] ?? "{}").scripts.dev, framework).toBe(dev);
    }
  });
});

describe("AGENTS.md", () => {
  it("says files recompile as they are saved, and database content shows when published", () => {
    for (const { name: framework } of SITE_FRAMEWORKS) {
      const fromFiles = scaffoldFiles({ ...base, framework })["AGENTS.md"];
      expect(fromFiles, framework).toContain("Content recompiles as you save a file");
      expect(fromFiles, framework).not.toContain("npx graft compile` after editing");
      const live = scaffoldFiles({ ...base, framework, source: "database", index: "postgres" })[
        "AGENTS.md"
      ];
      expect(live, framework).toContain("a publish in Studio shows on the next page load");
      expect(live, framework).not.toContain("recompiles");
    }
  });
});

describe("the Astro, React Router and TanStack Start sites", () => {
  it("read Postgres at DATABASE_URL, which graft dev loads from .env", () => {
    for (const [framework, reader] of [
      ["astro", "src/lib/graft.ts"],
      ["react-router", "app/lib/graft.server.ts"],
      ["tanstack-start", "src/lib/graft.server.ts"],
    ] as const) {
      const files = scaffoldFiles({ ...base, framework, source: "database", index: "postgres" });
      expect(files[reader], framework).toContain("process.env.DATABASE_URL");
      expect(files[reader], framework).not.toContain("openStaticIndex");
      expect(scaffoldFiles({ ...base, framework })[reader], framework).toContain("openStaticIndex");
    }
  });

  it("never let a TanStack Start route import the reader, since its loader runs in the browser too", () => {
    const files = scaffoldFiles({ ...base, framework: "tanstack-start" });
    const routes = Object.entries(files).filter(([path]) => path.startsWith("src/routes/"));
    expect(routes.length).toBeGreaterThan(0);
    for (const [path, body] of routes) {
      expect(body, path).not.toMatch(/graft\.server|content\.server/);
    }
    expect(files["src/lib/content.ts"]).toContain("createServerFn");
  });

  it("keep React Router's reads in .server.ts modules, which it refuses to bundle for the browser", () => {
    const files = scaffoldFiles({ ...base, framework: "react-router" });
    const readers = Object.entries(files)
      .filter(([, body]) => body.includes("graft.listContent") || body.includes("createGraft("))
      .map(([path]) => path);
    expect(readers.sort()).toEqual(["app/lib/content.server.ts", "app/lib/graft.server.ts"]);
  });
});
