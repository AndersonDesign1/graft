/**
 * The app's Graft handle — the compiled static index, not a database.
 *
 * `graft compile` writes `.graft/index.db`, a SQLite artifact derived from the
 * MDX in `content/`. Reading it needs no service, which is the whole point for
 * a documentation site: these docs cannot go down with a database they never
 * had, and a page view costs nothing.
 *
 * Server-only: import from .astro frontmatter and endpoints, never islands.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { STATIC_INDEX_DEFAULT_PATH } from "@usegraft/contracts";
import { openStaticIndex } from "@usegraft/db";
import { createGraft, type Graft } from "@usegraft/sdk-astro";
import { collections } from "../../graft.config";

/**
 * Where the compiled artifact is, in each place this code runs.
 *
 * `astro build` runs with cwd at this package, so `.graft/index.db` is right
 * there. A deployed Vercel function runs with cwd at its own root, and the
 * adapter's `includeFiles` copies the artifact in at its repository-relative
 * path — `examples/docs-site/.graft/index.db` — because this is a monorepo.
 * Neither location is wrong; they are just different, and hardcoding either one
 * breaks the other.
 *
 * So both are tried, and a miss reports every path it looked at. A silent
 * failure here would take out /mcp and /api/search on a deploy while the
 * prerendered pages carried on working, which is the hardest kind of outage to
 * read from the outside.
 */
const CANDIDATES = [
  STATIC_INDEX_DEFAULT_PATH,
  join("examples", "docs-site", STATIC_INDEX_DEFAULT_PATH),
];

export function resolveStaticIndexPath(): string {
  const tried = CANDIDATES.map((candidate) => resolve(process.cwd(), candidate));
  const found = tried.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Compiled static index not found. Looked in: ${tried.join(", ")}. ` +
        "Run `graft compile` first — the docs build is `graft compile && astro build`.",
    );
  }
  return found;
}

export const staticIndexPath = resolveStaticIndexPath();

/** What this app actually calls. `client` is part of Graft and unused here. */
type DocsGraft = Pick<Graft<typeof collections>, "getContent" | "listContent" | "searchContent">;

let opening: Promise<Graft<typeof collections>> | null = null;

/**
 * Opened once, lazily. The artifact is read-only and derived, so one handle is
 * safe to share across every request and the whole prerender pass.
 */
function open(): Promise<Graft<typeof collections>> {
  opening ??= openStaticIndex(staticIndexPath).then((index) => createGraft({ index, collections }));
  return opening;
}

/**
 * Returns the handle synchronously so call sites stay `await
 * getGraft().listContent(...)`. Nothing is hidden: every method on Graft
 * already returns a promise, and these await the open before delegating.
 */
export function getGraft(): DocsGraft {
  return {
    getContent: async (collection, slug, options) =>
      (await open()).getContent(collection, slug, options),
    listContent: async (collection, options) => (await open()).listContent(collection, options),
    searchContent: async (collection, query, options) =>
      (await open()).searchContent(collection, query, options),
  };
}
