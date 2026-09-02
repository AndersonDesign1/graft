/**
 * Documented install commands carry no dist-tag. This keeps them that way.
 *
 * The rule used to be the opposite. `latest` pointed at 0.2.0 while every page
 * described `1.0.0-beta.x`, so a reader copying `npm i @usegraft/cli` landed on
 * a build that did not match the page — during that beta, `approvalPolicy` in
 * config silently doing nothing, because 0.2.0 still read an environment
 * variable. The fix at the time was to write `@beta` into all 22 files and
 * derive the tag from `.changeset/pre.json`.
 *
 * That was treating the symptom. The real defect was the dist-tag: `latest`
 * is what a bare install resolves, and it pointed somewhere we did not want
 * anyone. On 2026-09-02 `latest` was moved to the prerelease across all 21
 * published packages, and the 0.x line deprecated. A bare install now lands on
 * the version the docs describe, which is what `latest` is for.
 *
 * So the tag comes off, and the invariant this script enforces is the simple
 * one: **an install command in this repo names a package and nothing else.**
 * A tag reappearing means someone is documenting a channel again, and the two
 * halves — what `latest` resolves and what the docs say — have to agree.
 *
 * ⚠️ The half this script cannot see is the registry. It enforces that the docs
 * carry no tag; it cannot check that `latest` still points where we think.
 * Publishing a prerelease while `latest` sits on something older reopens the
 * original bug, and nothing here will catch it. That is a release-process
 * property, kept by moving the tag, not a property of this file.
 *
 *   node scripts/install-tag.mjs           strip any tag from install commands
 *   node scripts/install-tag.mjs --check   exit 1 if anything carries one
 *
 * CHANGELOGs are deliberately untouched. They narrate what happened at a
 * version — "`npm i @usegraft/sdk-react` installed postgres and drizzle-orm" is
 * a statement about the past, and rewriting it would falsify the record.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");

/** Build output and dependencies never hold a hand-written install command. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".astro",
  ".vercel",
  ".turbo",
  ".graft",
  ".next",
]);

/** Every file under `dir` whose extension is in `exts`, recursively. */
function walk(dir, exts, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), exts, found);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

/**
 * Files that tell a reader how to install. Not CHANGELOGs — see the note above.
 *
 * The landing was missing for a while, and the failure was the one this script
 * exists to prevent: the docs said `@usegraft/cli@beta` while the front page —
 * the first install command anyone sees — said `@usegraft/cli`, sending readers
 * to 0.2.0. Prose is not the only place a command lives, so the source of the
 * site that renders it is scanned too, and by directory rather than by a list
 * of filenames, so a new component carrying a command is covered by existing.
 *
 * This script itself is deliberately not a target. It quotes install commands
 * in its own header to explain what it does, and rewriting those would turn an
 * explanation into a claim about the current channel.
 */
function targets() {
  const files = [];
  const readme = join(root, "README.md");
  if (existsSync(readme)) files.push(readme);

  for (const group of ["packages", "examples"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(dir, entry.name, "README.md");
      if (existsSync(candidate)) files.push(candidate);
    }
  }

  const site = join(root, "examples", "docs-site");
  files.push(...walk(join(site, "content"), [".mdx", ".md"]));
  files.push(...walk(join(site, "src"), [".ts", ".tsx", ".astro"]));

  return files;
}

/**
 * An install command naming a @usegraft package, with whatever tag it carries.
 *
 * Anchored on the runner so prose mentioning a package name is left alone —
 * only a line someone would paste into a terminal is rewritten.
 */
const INSTALL =
  /((?:npm i|npm install|pnpm add|pnpm dlx|npx|bunx|yarn add)(?:\s+-\w+)*\s+@usegraft\/[a-z-]+)(@[a-z0-9.-]+)?/g;

const changed = [];

for (const file of targets()) {
  const before = readFileSync(file, "utf8");
  // The capture group is the command without its tag, so dropping the second
  // group is the whole rewrite.
  const after = before.replace(INSTALL, (_match, command) => command);
  if (after === before) continue;
  changed.push(file.slice(root.length + 1).replaceAll("\\", "/"));
  if (!check) writeFileSync(file, after);
}

if (check) {
  if (changed.length > 0) {
    console.error("install commands carry a dist-tag; they should name the package alone:\n");
    for (const file of changed) console.error(`  ${file}`);
    console.error("\n`latest` is the channel. Run `pnpm install-tag` to strip them.");
    process.exit(1);
  }
  console.log("install tags: OK — every command names the package alone.");
  process.exit(0);
}

if (changed.length === 0) console.log("install tags: nothing to change.");
for (const file of changed) console.log(`  stripped tag in ${file}`);
