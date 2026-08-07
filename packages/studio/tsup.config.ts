/**
 * Server library + the React embed surface (`@graft/studio/panels`).
 *
 * A config file rather than CLI flags because the externals need regexes:
 * the UI imports deep subpaths (`@phosphor-icons/react/dist/icons/X`,
 * `@base-ui-components/react/menu`), which an exact-name `--external` does
 * not match — so they were being inlined and the embed bundle carried a copy
 * of CodeMirror and the icon set.
 *
 * Everything listed here is an optional peer: a host embedding a panel brings
 * its own React and UI libraries, exactly as it already did for React.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/panels-entry.ts"],
  format: ["esm"],
  dts: true,
  /**
   * Cleaning is handled by scripts/clean-lib.mjs, which removes only the
   * top-level files in dist/. Both `clean: true` and its glob form reach into
   * `dist/ui` — the Vite bundle that lives in the same directory — and wiping
   * it left the Studio serving a 500 until the UI was rebuilt.
   */
  clean: false,
  external: [
    "react",
    "react-dom",
    /^react\//,
    /^react-dom\//,
    /^@base-ui-components\//,
    /^@phosphor-icons\//,
    /^@codemirror\//,
    /^@lezer\//,
  ],
});
