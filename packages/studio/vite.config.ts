/**
 * Studio SPA bundle. Replaces the old esbuild script so UI work gets HMR.
 *
 * `base: "./"` is load-bearing: the same build is served at `/` by
 * `graft studio` and under `/studio/` by `graft serve --studio`, so every
 * asset reference has to be relative to the document.
 */
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.GRAFT_STUDIO_ORIGIN ?? "http://127.0.0.1:4983";

export default defineConfig({
  root: fileURLToPath(new URL("./src/ui", import.meta.url)),
  base: "./",
  plugins: [react()],
  resolve: {
    /**
     * Milkdown identifies a context Slice by object identity. Crepe bundles
     * its own path to `@milkdown/core`, so a second copy — reached through
     * `@milkdown/kit/core`, or created by dep pre-bundling — hands out
     * different Slice objects and `ctx.update(remarkStringifyOptionsCtx)`
     * fails with `contextNotFound` against a slice the editor did inject.
     * One copy of each, so identity holds.
     */
    dedupe: ["@milkdown/core", "@milkdown/ctx", "@milkdown/kit", "@milkdown/transformer"],
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/ui", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    // The editor is the heavy dependency and it never changes between Studio
    // builds. Splitting it out means editing a view invalidates ~40 kB rather
    // than the whole megabyte, which matters because hashed assets are served
    // `immutable`.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) takes the function form only.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          // Both editors and their parser stacks. They are the bulk of the
          // bundle and never change between Studio builds, so they cache
          // independently of the app.
          if (
            id.includes("@codemirror") ||
            id.includes("@lezer") ||
            id.includes("@milkdown") ||
            id.includes("prosemirror") ||
            id.includes("remark") ||
            id.includes("micromark") ||
            id.includes("mdast")
          ) {
            return "editor";
          }
          if (
            id.includes("@base-ui-components") ||
            id.includes("cmdk") ||
            id.includes("sonner") ||
            /[/\\]react(-dom)?[/\\]/.test(id)
          ) {
            return "vendor";
          }
          return;
        },
      },
    },
  },
  server: {
    port: 5173,
    // Dev server holds the UI; the API stays on a real `graft studio` process.
    proxy: {
      "/api/studio": {
        target: apiTarget,
        changeOrigin: true,
        // The API refuses cross-origin state-changing requests (CSRF: a
        // loopback Studio has no auth, so any page could POST to it). In dev
        // the browser's Origin is this Vite server, so rewrite it to the API's
        // own origin — the request really is the Studio's, it just took a
        // detour. Dev-only: nothing in production proxies through Vite.
        headers: { origin: apiTarget },
      },
    },
  },
});
