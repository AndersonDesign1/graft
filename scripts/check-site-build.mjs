/**
 * Assert that the built docs site is one that would actually serve.
 *
 * `astro build` exiting 0 says the site compiled, not that it works. graft.page
 * is a fully static deploy with two on-demand routes bolted to the side, and
 * every way it has broken so far was invisible to the build:
 *
 *   - `/docs` was a page calling `Astro.redirect()`. That worked while the site
 *     was server-rendered and silently stopped the moment it went static
 *     (db5abe6) — a build with nothing wrong in it and a dead entry point.
 *   - `/api/search` and `/mcp` read the compiled SQLite index at runtime. Vercel
 *     traces imports, not data files, so the adapter has to name the artifact.
 *     Drop that `includeFiles` and both routes deploy, respond, and 500 — the
 *     build is clean, the deploy is green, the search box is dead.
 *
 * Neither is a compile error, so neither fails `pnpm build`. Both are checked
 * here, against the artifact Vercel actually uploads, because that artifact is
 * the only place the answer exists.
 *
 * Run after `pnpm build`. Reads `.vercel/output`, writes nothing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { authoredRoutesFromIndex, expectedStaticFiles } from "./site-routes.mjs";

const SITE = "examples/docs-site";
const OUT = join(SITE, ".vercel", "output");
const STATIC = join(OUT, "static");
const failures = [];

const fail = (what) => failures.push(what);

if (!existsSync(OUT)) {
  console.error(`No build to check: ${OUT} does not exist. Run \`pnpm build\` first.`);
  process.exit(1);
}

/** Every file under a directory, as paths relative to it, with forward slashes. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(relative(STATIC, full).replaceAll("\\", "/"));
  }
  return found;
}

const staticFiles = new Set(existsSync(STATIC) ? walk(STATIC) : []);
const pages = [...staticFiles].filter((f) => f.endsWith(".html"));

if (pages.length === 0) {
  console.error("The build produced no HTML at all. Nothing below would be meaningful.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Every authored page reached the build.
//
// A page can leave the site without anything failing: a content file renamed,
// a getStaticPaths filter that quietly matches less than it did.
//
// The expected routes come from the compiled index, not from the filenames
// under content/. Reading the directory meant re-deriving the compiler's slug
// rule, and the re-derivation was wrong in both directions: `parse.ts` honours
// a frontmatter `slug` over the filename, so `a.mdx` with `slug: b` builds at
// /docs/b and this demanded /docs/a — a green build failed by the checker; and
// it only listed the top level, so anything nested was never checked at all.
//
// index.db is what `getStaticPaths` itself reads, so the two cannot disagree
// about which routes exist. node:sqlite is why this repo's Node floor is 22.16.
// The static artifact has no `deleted` column, so there is nothing to filter.
// ---------------------------------------------------------------------------
const indexDb = join(SITE, ".graft", "index.db");
if (!existsSync(indexDb)) {
  console.error(`No compiled index at ${indexDb}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const authored = (() => {
  const db = new DatabaseSync(indexDb, { readOnly: true });
  try {
    return authoredRoutesFromIndex(db);
  } finally {
    db.close();
  }
})();

if (authored.docs.length === 0)
  fail("The compiled index holds no docs to check the build against.");

for (const path of expectedStaticFiles(authored)) {
  if (!staticFiles.has(path)) {
    const href = path.endsWith(".md") ? `/${path}` : `/${path.replace(/index\.html$/, "")}`;
    fail(`compiled but not built: ${href}`);
  }
}

// Absolute-URL manifests. They are prerendered, so a missing `site` in the
// Astro config makes them build against a localhost placeholder rather than
// fail — checked for content further down.
for (const path of ["llms.txt", "llms-full.txt"]) {
  if (!staticFiles.has(path)) fail(`missing manifest: /${path}`);
}

// ---------------------------------------------------------------------------
// The on-demand routes are wired to a function, and that function carries the
// data file it reads.
// ---------------------------------------------------------------------------
let config;
try {
  config = JSON.parse(readFileSync(join(OUT, "config.json"), "utf8"));
} catch (error) {
  fail(`.vercel/output/config.json is unreadable (${error.message}) — routing is unverifiable.`);
  config = { routes: [] };
}

/**
 * Routes that can actually answer a request, which is not all of them.
 *
 * The generated config ends with `{"src":"^/.*$","dest":"_render","status":404}`
 * — a catch-all whose entire job is to serve the 404 page. Matching against the
 * raw list therefore says every conceivable path resolves, and the first version
 * of this file did exactly that: it reported "no dead internal links" while
 * checking nothing, because every link matched the catch-all. A check that
 * cannot fail is worse than no check, since it also reports success.
 *
 * So two kinds are dropped. `status >= 400` is a route that answers with an
 * error, and `continue: true` is a route that only attaches headers and hands
 * the request onward — neither is a destination.
 */
const routes = (Array.isArray(config.routes) ? config.routes : []).filter(
  (r) =>
    typeof r.src === "string" &&
    r.continue !== true &&
    !(typeof r.status === "number" && r.status >= 400) &&
    (r.dest !== undefined || r.headers?.Location !== undefined),
);

const routed = (path) =>
  routes.some((r) => {
    try {
      return new RegExp(r.src).test(path);
    } catch {
      return false; // A src this script cannot parse is not one it will vouch for.
    }
  });

for (const path of ["/api/search", "/mcp"]) {
  if (!routed(path)) fail(`${path} has no route in config.json — it would 404 in production.`);
}

// `/docs` is a redirect in config, not a page. It is the entry point every
// "Docs" link in the chrome points at, and it broke once by becoming a page
// that could not redirect.
if (!routed("/docs")) fail("/docs resolves to nothing — the docs entry point is dead.");

const functionsDir = join(OUT, "functions");
if (!existsSync(functionsDir)) {
  fail("No functions were emitted, so /api/search and /mcp cannot run.");
} else {
  const bundled = walk(functionsDir).map((f) => f.replaceAll("\\", "/"));
  // The compiled index is read at runtime by both on-demand routes. Vercel
  // traces imports and would not find a .db on its own.
  if (!bundled.some((f) => f.endsWith("/index.db") || f.endsWith("index.db"))) {
    fail(
      "The compiled index (.graft/index.db) is not inside the function bundle." +
        " /api/search and /mcp would deploy and fail at runtime.",
    );
  }
}

// ---------------------------------------------------------------------------
// Pages are pages, not shells.
// ---------------------------------------------------------------------------
const SHELL_BYTES = 1024;
for (const page of pages) {
  const full = join(STATIC, page);
  const size = statSync(full).size;
  if (size < SHELL_BYTES) {
    fail(`/${page} is ${size} bytes — too small to be a rendered page.`);
    continue;
  }
  const html = readFileSync(full, "utf8");
  if (!/<title[^>]*>\s*\S/.test(html)) fail(`/${page} has no non-empty <title>.`);
}

// A prerendered absolute-URL manifest built without `site` points at Astro's
// localhost placeholder, which is not a build error and breaks every link in it.
for (const manifest of ["llms.txt", "llms-full.txt"]) {
  if (!staticFiles.has(manifest)) continue;
  const text = readFileSync(join(STATIC, manifest), "utf8");
  if (/localhost:\d+/.test(text)) {
    fail(`/${manifest} contains a localhost URL — it was built without a canonical \`site\`.`);
  }
}

// ---------------------------------------------------------------------------
// Every internal link resolves to something this deploy serves.
//
// This is the check that would have caught the dead `/docs`: the link was
// present and correct in the chrome, and the destination stopped existing.
// ---------------------------------------------------------------------------
/** Does a site-absolute path resolve to a static file, a redirect, or a function? */
function resolves(path) {
  const clean = path.replace(/[?#].*$/, "");
  const bare = clean.replace(/^\/+/, "").replace(/\/+$/, "");
  if (bare === "") return staticFiles.has("index.html");
  return (
    staticFiles.has(bare) ||
    staticFiles.has(`${bare}/index.html`) ||
    staticFiles.has(`${bare}.html`) ||
    routed(clean)
  );
}

/**
 * `href` in all three spellings HTML allows.
 *
 * The first version matched `href="..."` only, so `href='/missing-page'` was
 * not a link this file could see — and a link it cannot see is one it reports
 * as fine, which is the same way round as every other bug found in this batch.
 * Not theoretical here: `rehype-raw` is a dependency, so MDX may carry raw HTML
 * written by hand, and hand-written HTML is exactly where the other quote style
 * shows up.
 */
const HREF = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=`]+))/g;

const broken = new Map();
for (const page of pages) {
  const html = readFileSync(join(STATIC, page), "utf8");
  for (const match of html.matchAll(HREF)) {
    const href = match[1] ?? match[2] ?? match[3];
    if (!href) continue;
    // Off-site, in-page, and non-navigational schemes are not this build's job.
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    if (resolves(href)) continue;
    const key = href.replace(/[?#].*$/, "");
    if (!broken.has(key)) broken.set(key, new Set());
    broken.get(key).add(`/${page}`);
  }
}

for (const [href, sources] of broken) {
  const from = [...sources].slice(0, 3).join(", ");
  const more = sources.size > 3 ? ` and ${sources.size - 3} more` : "";
  fail(`dead internal link ${href} — linked from ${from}${more}`);
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nThe built site has ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "\nEach of these builds cleanly and breaks in production, which is why the" +
      "\nbuild passing is not the thing worth checking. Fix, then re-run" +
      "\n`pnpm build && pnpm check:site`.\n",
  );
  process.exit(1);
}

console.log(
  `site build: OK — ${pages.length} pages, ${authored.docs.length} docs from the compiled index, ` +
    `on-demand routes wired with their index, no dead internal links.`,
);
