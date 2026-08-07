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
          if (id.includes("@codemirror") || id.includes("@lezer")) return "editor";
          if (id.includes("@base-ui-components") || /[/\\]react(-dom)?[/\\]/.test(id)) {
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
      "/api/studio": { target: apiTarget, changeOrigin: true },
    },
  },
});
