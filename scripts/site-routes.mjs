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

/**
 * Routes in `.vercel/output/config.json` that can answer a plain request,
 * which is not all of them.
 *
 * The generated config ends with `{"src":"^/.*$","dest":"_render","status":404}`
 * — a catch-all whose entire job is to serve the 404 page. Matching against the
 * raw list therefore says every conceivable path resolves, and the first version
 * of the checker did exactly that: it reported "no dead internal links" while
 * checking nothing, because every link matched the catch-all. A check that
 * cannot fail is worse than no check, since it also reports success.
 *
 * So three kinds are dropped. `status >= 400` is a route that answers with an
 * error. `continue: true` only attaches headers and hands the request onward.
 * And a route with `has` applies only when the request meets its header,
 * cookie, host or query conditions: the docs' `Accept: text/markdown` rewrite
 * matches every kebab-case `/docs/<slug>`, so counting it let `/docs/functions`,
 * a page that never existed, pass as a live link. A link followed in a browser
 * meets none of those conditions.
 *
 * @param {unknown} configRoutes
 * @returns {Array<{ src: string }>}
 */
export function destinationRoutes(configRoutes) {
  return (Array.isArray(configRoutes) ? configRoutes : []).filter(
    (r) =>
      typeof r.src === "string" &&
      r.continue !== true &&
      r.has === undefined &&
      !(typeof r.status === "number" && r.status >= 400) &&
      (r.dest !== undefined || r.headers?.Location !== undefined),
  );
}
