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
  },
  server: {
    port: 5173,
    // Dev server holds the UI; the API stays on a real `graft studio` process.
    proxy: {
      "/api/studio": { target: apiTarget, changeOrigin: true },
    },
  },
});
