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

/** Files that tell a reader how to install. Not CHANGELOGs — see the note above. */
function targets() {
  const files = [];
  const readme = join(root, "README.md");
  if (existsSync(readme)) files.push(readme);

  const packages = join(root, "packages");
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(packages, entry.name, "README.md");
      if (existsSync(candidate)) files.push(candidate);
    }
  }

  const docs = join(root, "examples", "docs-site", "content", "docs");
  if (existsSync(docs)) {
    for (const name of readdirSync(docs)) {
      if (name.endsWith(".mdx")) files.push(join(docs, name));
    }
  }
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
