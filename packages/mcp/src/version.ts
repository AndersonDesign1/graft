/**
 * This package's version, for `serverInfo`. Imported from the manifest so the
 * bundler inlines the string: changesets bumps package.json, and the literal
 * that stood in for it shipped every release as "0.0.0". Inlined rather than
 * read at runtime, because an app bundles this package and its manifest is
 * not there to read.
 */
import { version } from "../package.json";

export const VERSION: string = version;
