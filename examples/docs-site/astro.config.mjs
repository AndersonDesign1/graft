// @ts-check
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Env layering, most specific wins: repo-root .env fills shared values
// (GRAFT_DEV_TOKEN, …), then this app's own .env overrides on top — the
// docs site owns its own database (graft_docs), never the landing page's.
// Both loads are harmless when the file is absent (CI, prod).
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
  // Server output: sdk-astro reads go straight to Postgres per request (no
  // request memo — a page makes a handful of reads). Pages can opt back into
  // prerendering with `export const prerender = true` once the compile-webhook
  // → CDN-purge loop from the Phase 4 tag contract is wired up.
  output: "server",
  adapter: vercel(),
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
