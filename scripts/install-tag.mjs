/**
 * Keep every documented install command on the channel we are actually shipping.
 *
 * While the repo is in beta prerelease mode, `latest` is an older version than
 * the docs describe. Someone copying `npm i @usegraft/cli` off a README lands on
 * a build that does not match the page they read it from — during this beta,
 * that means `approvalPolicy` in config silently doing nothing, because 0.2.0
 * still reads an environment variable.
 *
 * So the tag is derived from `.changeset/pre.json` rather than remembered:
 * pre mode means `@beta`, stable means no tag. `release:beta-enter` and
 * `release:beta-exit` run this, so entering and leaving the channel rewrites
 * the docs with it and neither direction has to be done by hand.
 *
 *   node scripts/install-tag.mjs           rewrite to match the channel
 *   node scripts/install-tag.mjs --check   exit 1 if anything is out of sync
 *
 * CHANGELOGs are deliberately untouched. They narrate what happened at a
 * version — "`npm i @usegraft/sdk-react` installed postgres and drizzle-orm" is
 * a statement about the past, and rewriting it would falsify the record.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");

/** The dist-tag the current channel installs from, or "" for stable. */
function currentTag() {
  const pre = join(root, ".changeset", "pre.json");
  if (!existsSync(pre)) return "";
  const parsed = JSON.parse(readFileSync(pre, "utf8"));
  // `mode: "exit"` leaves the file in place so the next version can graduate
  // the accumulated prereleases. That is stable, not beta.
  return parsed.mode === "pre" ? String(parsed.tag) : "";
}

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

const tag = currentTag();
const want = tag ? `@${tag}` : "";
const changed = [];

for (const file of targets()) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(INSTALL, (_match, command) => `${command}${want}`);
  if (after === before) continue;
  changed.push(file.slice(root.length + 1).replaceAll("\\", "/"));
  if (!check) writeFileSync(file, after);
}

const channel = tag
  ? `${tag} (install commands carry @${tag})`
  : "stable (install commands carry no tag)";

if (check) {
  if (changed.length > 0) {
    console.error(`install tags are out of sync with the ${channel.split(" ")[0]} channel:\n`);
    for (const file of changed) console.error(`  ${file}`);
    console.error("\nRun `pnpm install-tag` to fix.");
    process.exit(1);
  }
  console.log(`install tags: OK — every command matches the ${channel}.`);
  process.exit(0);
}

console.log(`install tags: channel is ${channel}.`);
if (changed.length === 0) console.log("  nothing to change.");
for (const file of changed) console.log(`  updated ${file}`);
