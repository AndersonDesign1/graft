/**
 * Expected static files for the docs site, derived from the compiled index.
 *
 * `getStaticPaths` reads `.graft/index.db`, so the build checker must too.
 * Filenames are the wrong source: `parse.ts` honours a frontmatter `slug` over
 * the filename, and a top-level `readdir` never sees a nested document.
 *
 * The static artifact has no `deleted` column — every row here is live.
 */

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
    files.push(`docs/${slug}/index.html`);
    files.push(`docs/${slug}.md`);
  }
  for (const slug of authored.pages) {
    files.push(slug === "home" ? "index.html" : `${slug}/index.html`);
  }
  return files;
}
