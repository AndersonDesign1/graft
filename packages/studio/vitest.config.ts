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
    // `git commit` starts a detached `git maintenance run --auto`, which can
    // still be writing to .git/objects when a test deletes its repository
    // (ENOTEMPTY in afterEach). Every git a test or Studio runs reads this.
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "maintenance.auto",
      GIT_CONFIG_VALUE_0: "false",
    },
  },
});
