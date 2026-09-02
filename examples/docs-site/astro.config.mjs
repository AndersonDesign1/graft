// @ts-check
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Env layering, most specific wins: repo-root .env fills shared values, then
// this app's own .env overrides on top. Both loads are harmless when the file
// is absent (CI, prod) — and this site needs no DATABASE_URL at all now that it
// reads the compiled static index.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

for (const rel of ["../../.env", "./.env"]) {
  try {
    const parsed = parseEnv(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
    Object.assign(process.env, parsed);
  } catch {
    /* file absent — rely on the ambient environment */
  }
}

// https://astro.build/config
export default defineConfig({
  // Prerendered by default. Content is MDX in git compiled to a SQLite
  // artifact, so every page can be built once and served from the CDN: the docs
  // cannot go down with a database they no longer have, and a page view costs
  // nothing. `graft compile` runs before `astro build` (see package.json) so
  // the artifact exists when the prerender pass reads it.
  //
  // Two routes opt out with `export const prerender = false` because they take
  // input rather than a slug: /api/search and /mcp, the public docs MCP. Both
  // read the same artifact.
  // The canonical origin, and load-bearing rather than decorative: /llms.txt
  // and /llms-full.txt render absolute links, and prerendering gives them no
  // request to read an origin from. Without this they build against Astro's
  // placeholder and ship pointing at http://localhost:4321.
  //
  // Apex, not www — www.graft.page redirects here.
  site: "https://graft.page",

  // Every page here is a static file on a CDN, so the only cost left in a
  // navigation is the round trip. Hovering a sidebar link starts it early.
  //
  // prefetchAll because the sidebar is the whole point of a docs site and
  // opting in link by link through a fumadocs React island is not reachable
  // from here. "hover" rather than "viewport": the sidebar puts 36 links on
  // screen at once, and viewport strategy would fetch all of them to serve
  // the one someone actually wants.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },

  output: "static",

  // /docs is a signpost, not a page. It used to be src/pages/docs/index.astro
  // calling Astro.redirect(), which worked when this site was server-rendered
  // and stopped working the moment it went static (db5abe6): a prerendered
  // route cannot emit an HTTP status, so Astro fell back to writing a
  // <meta http-equiv="refresh" content="2;url=..."> page. Readers got two
  // seconds of unstyled black-on-white text before the docs appeared.
  //
  // Declared here instead, the Vercel adapter turns it into a routing rule in
  // .vercel/output/config.json, so it is a real 308 at the edge with no HTML,
  // no delay, and no function invocation.
  //
  // The target is written out rather than derived from docsNav()[0]. Config is
  // evaluated before the content index is guaranteed to exist, and a redirect
  // that reads a database is a redirect that can fail to build. nav.test.ts
  // pins this slug against the real nav so the two cannot drift apart.
  redirects: {
    "/docs": "/docs/what-is-graft",
  },
  // The prerendered pages need no artifact at runtime, but the two on-demand
  // routes do: /api/search and /mcp both read the compiled index. Vercel traces
  // imports, not data files, so it has to be named or the functions deploy
  // without the thing they read.
  adapter: vercel({ includeFiles: [".graft/index.db"] }),
  integrations: [react()],
  vite: {
    // Tailwind v4 processes the fumadocs-ui stylesheet (docs shell only; the
    // landing + tokens stay hand-written CSS).
    plugins: [tailwindcss()],
    ssr: {
      // @usegraft/registry reads its bundled primitives from disk at runtime
      // (path-form registryRoot()) — never inline it into the SSR bundle.
      // Same reason sdk-next's withGraft sets serverExternalPackages.
      external: ["@usegraft/registry"],
    },
  },
});
