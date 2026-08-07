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
  clean: true,
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
