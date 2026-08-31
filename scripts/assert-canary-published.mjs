/**
 * After a canary publish, ask the registry what actually landed.
 *
 * `changeset publish` cannot be trusted to report this. On 2026-08-31 it
 * printed `error an error occurred while publishing @usegraft/content-api:
 * E404` for six packages, then listed **all twenty-one** under "packages
 * published successfully:" and printed an empty "packages failed to publish:"
 * list. The job exited 1, so the failure was not silent — but the one piece of
 * output that names which packages need attention was wrong, and working out
 * the real answer meant querying the registry by hand for every package.
 *
 * A partial canary is worse than none: internal dependencies are pinned to the
 * exact snapshot version, so fifteen packages published against six that were
 * not leaves `npm i @usegraft/cli@canary` failing with ETARGET. The `canary`
 * dist-tag points at something nobody can install.
 *
 * This runs whether the publish succeeded or failed, and names the packages the
 * registry does not have.
 *
 * Run: node scripts/assert-canary-published.mjs
 */
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SNAPSHOT = /^0\.0\.0-/;
const REGISTRY = "https://registry.npmjs.org";

/**
 * A brand-new version takes a moment to become readable, and the registry
 * caches a 404 it served a second earlier. Retry a few times before believing
 * one — see the note in phases.md about read lag on a fresh publish.
 */
const ATTEMPTS = 4;
const BACKOFF_MS = 5000;

function workspaceGlobs() {
  const lines = readFileSync("pnpm-workspace.yaml", "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  const globs = [];
  for (let i = start + 1; start !== -1 && i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    const item = lines[i].match(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/);
    if (item) globs.push(item[1]);
  }
  if (globs.length === 0) {
    throw new Error("Parsed no workspace globs from pnpm-workspace.yaml. Refusing to guess.");
  }
  return globs;
}

function publishablePackages() {
  const seen = new Set();
  const found = [];
  for (const glob of workspaceGlobs()) {
    for (const manifestPath of globSync(join(glob, "package.json"))) {
      const dir = dirname(manifestPath);
      if (seen.has(dir)) continue;
      seen.add(dir);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private === true || !manifest.name || !manifest.version) continue;
      found.push({ name: manifest.name, version: manifest.version });
    }
  }
  return found;
}

async function isPublished(name, version) {
  const url = `${REGISTRY}/${name}/${version}`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.ok) return true;
      // Anything other than "not there yet" is worth reporting as-is rather
      // than retried into a timeout.
      if (response.status !== 404) return false;
    } catch {
      // Network flake; a retry is exactly the right response.
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, BACKOFF_MS));
  }
  return false;
}

const packages = publishablePackages();
const snapshots = packages.filter((pkg) => SNAPSHOT.test(pkg.version));

if (snapshots.length === 0) {
  console.log(
    "No snapshot versions in the workspace, so no canary publish to verify. Nothing to do.",
  );
  process.exit(0);
}

const results = await Promise.all(
  snapshots.map(async (pkg) => ({ ...pkg, published: await isPublished(pkg.name, pkg.version) })),
);

const missing = results.filter((r) => !r.published);
const landed = results.filter((r) => r.published);

console.log(`Canary verification — ${landed.length} of ${results.length} on the registry.`);
for (const pkg of landed) console.log(`  ok      ${pkg.name}@${pkg.version}`);
for (const pkg of missing) console.log(`  MISSING ${pkg.name}@${pkg.version}`);

if (missing.length === 0) {
  console.log("\nEvery package published. The canary tag is installable.");
  process.exit(0);
}

console.error(
  [
    "",
    `${missing.length} package(s) did not publish, so this canary is NOT installable:`,
    ...missing.map((pkg) => `  - ${pkg.name}`),
    "",
    "Internal dependencies pin the exact snapshot version, so anything depending",
    "on one of these fails to resolve with ETARGET even though its own publish",
    "succeeded. Do not announce this canary.",
    "",
    "The usual cause is a missing or mismatched trusted publisher on npmjs.com.",
    "OIDC cannot perform a package's FIRST publish, so a package published by",
    "hand needs its trusted publisher registered afterwards as a separate step —",
    "GitHub Actions, AndersonDesign1/graft, release.yml, Environment left BLANK.",
    "A mismatched claim fails the exchange and surfaces here as E404.",
    "",
    "Fix those, then dispatch the canary again. A re-run mints a new timestamp",
    "and republishes every package at it, so there is nothing to unpick.",
  ].join("\n"),
);
process.exit(1);
