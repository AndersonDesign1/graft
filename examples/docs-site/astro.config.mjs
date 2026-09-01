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
  output: "static",
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
