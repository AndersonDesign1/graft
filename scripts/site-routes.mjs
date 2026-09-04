/**
 * Expected static files for the docs site, derived from the compiled index.
 *
 * `getStaticPaths` reads `.graft/index.db`, so the build checker must too.
 * Filenames are the wrong source: `parse.ts` honours a frontmatter `slug` over
 * the filename, and a top-level `readdir` never sees a nested *source* file.
 *
 * The slug itself is still kebab-case. `SLUG_RE` in `@usegraft/compiler` rejects
 * slashes, and `parseDocument` takes `basename(sourcePath)` when frontmatter
 * has no slug — so `content/docs/guides/install/quickstart.mdx` compiles to
 * `quickstart` and the site serves it from `[slug].astro`, not `[...slug]`.
 *
 * The static artifact has no `deleted` column — every row here is live.
 */

/** Same rule as `packages/compiler/src/parse.ts`. Kept here so this script
 *  has no package import (the checker runs against a built site, not src). */
export const COMPILED_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {string} kind
 * @param {unknown} slug
 */
function assertCompiledSlug(kind, slug) {
  if (typeof slug !== "string" || !COMPILED_SLUG_RE.test(slug)) {
    throw new Error(
      `compiled ${kind} slug ${JSON.stringify(slug)} is not kebab-case. ` +
        "The compiler rejects path segments, and the site serves [slug], not [...slug].",
    );
  }
}

/**
 * @param {{ prepare: (sql: string) => { all: () => Array<{ collection: unknown; slug: unknown }> } }} db
 * @returns {{ docs: string[]; pages: string[] }}
 */
export function authoredRoutesFromIndex(db) {
  const authored = { docs: [], pages: [] };
  for (const row of db.prepare("SELECT collection, slug FROM content_index").all()) {
    if (row.collection === "docs" && typeof row.slug === "string") authored.docs.push(row.slug);
    if (row.collection === "pages" && typeof row.slug === "string") authored.pages.push(row.slug);
  }
  return authored;
}

/**
 * Paths under `.vercel/output/static` that must exist for each authored route.
 * `home` is the site root; every other `pages` slug sits at `/<slug>`.
 *
 * @param {{ docs: readonly string[]; pages: readonly string[] }} authored
 * @returns {string[]}
 */
export function expectedStaticFiles(authored) {
  const files = [];
  for (const slug of authored.docs) {
    assertCompiledSlug("docs", slug);
    files.push(`docs/${slug}/index.html`);
    files.push(`docs/${slug}.md`);
  }
  for (const slug of authored.pages) {
    assertCompiledSlug("pages", slug);
    files.push(slug === "home" ? "index.html" : `${slug}/index.html`);
  }
  return files;
}
