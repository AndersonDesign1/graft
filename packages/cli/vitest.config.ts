import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // graft check and graft compile keep a scan cache under XDG_CACHE_HOME,
      // and the update notice keeps its answer there. Tests write to a scratch
      // directory inside the package, never to the real ~/.cache.
      XDG_CACHE_HOME: fileURLToPath(new URL("./.test-tmp/xdg-cache", import.meta.url)),
    },
  },
});
