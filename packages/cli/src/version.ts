import { createRequire } from "node:module";

/**
 * This CLI's version. Read from the manifest rather than a literal:
 * changesets bumps package.json, and a hardcoded constant silently ships the
 * wrong number (0.1.0 shipped as "0.0.0"). `../package.json` resolves
 * identically from src/ under vitest and from dist/ in the published tarball,
 * where npm always includes the manifest.
 */
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;
