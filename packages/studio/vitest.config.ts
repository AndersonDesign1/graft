/**
 * Kept separate from vite.config.ts on purpose: that config sets
 * `root: src/ui` for the SPA build, which would hide every test under src/.
 * Vitest prefers this file when both exist.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
