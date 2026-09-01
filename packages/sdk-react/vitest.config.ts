/**
 * The only vitest config in packages/ that asks for a DOM, and the hooks are
 * why: `useEffect` never runs without one, so a Node-environment test of these
 * hooks would assert the loading state and nothing else — exactly the part
 * that cannot break.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
