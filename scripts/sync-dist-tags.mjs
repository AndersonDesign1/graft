/**
 * Move `latest` (and the prerelease tag) onto the version this repo just
 * released, on every publishable package.
 *
 * The fixer half of check-dist-tags.mjs. That script detects the drift and
 * refuses to call a release finished; this one closes it. They are separate on
 * purpose: the check runs in CI after every publish, and this cannot, because
 * the pipeline authenticates through OIDC trusted publishing and holds no npm
 * token — OIDC authorises `npm publish` alone, and `npm dist-tag add` needs a
 * credential the workflow deliberately does not have. So the tag move is a
 * human with publish rights, running this.
 *
 * The package list and the version are both derived, never typed. The obvious
 * alternative is a shell loop over 21 hardcoded names against a hardcoded
 * version, which is wrong the first time a package is added, removed, or
 * renamed, and wrong again at the next release — and wrong silently, because a
 * name that is simply absent from the list is one nobody notices going unpushed.
 *
 * Usage:
 *   node scripts/sync-dist-tags.mjs --dry-run   # say what would change
 *   node scripts/sync-dist-tags.mjs             # do it
 */
import {
  NPM_NAME,
  fetchDistTags,
  npm,
  publishablePackages,
  releaseChannel,
  releaseVersion,
} from "./lib/workspace.mjs";

const dryRun = process.argv.includes("--dry-run");

const packages = publishablePackages();
if (packages.length === 0) {
  console.error("Found no publishable workspace packages. Refusing to guess.");
  process.exit(1);
}

let version;
try {
  version = releaseVersion(packages);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { name: channelName, tags } = releaseChannel();

console.log(
  `Pointing ${tags.join(" and ")} at ${version} across ${packages.length} package(s) ` +
    `(${channelName} channel).${dryRun ? "  DRY RUN — nothing will change." : ""}\n`,
);

const planned = [];
const skipped = [];
const unreadable = [];

// Read over HTTP and in parallel — the registry is only being asked what a tag
// points at, which needs no npm and no subprocess. Writing still does.
const current = await Promise.all(packages.map((pkg) => fetchDistTags(pkg.name)));

for (const [i, pkg] of packages.entries()) {
  const result = current[i];
  // "Absent" is grouped with "failed" on purpose: this script moves a tag onto
  // a published version, and a package with nothing on the registry has no tag
  // to move. Either way it is untouched and worth saying so.
  if (result.kind !== "tags") {
    unreadable.push(`${pkg.name}${result.reason ? ` (${result.reason})` : " (not published)"}`);
    continue;
  }
  for (const tag of tags) {
    if (result.tags[tag] === version) skipped.push(`${pkg.name} ${tag}`);
    else planned.push({ name: pkg.name, tag, from: result.tags[tag] ?? "(unset)" });
  }
}

if (unreadable.length > 0) {
  console.log(`Could not read, so not touched: ${unreadable.join(", ")}\n`);
}
if (skipped.length > 0) {
  console.log(`Already correct, skipped: ${skipped.length}\n`);
}

if (planned.length === 0) {
  console.log("Nothing to move. Every tag already points at this version.");
  process.exit(unreadable.length > 0 ? 1 : 0);
}

for (const p of planned) console.log(`  ${p.name}  ${p.tag}: ${p.from} -> ${version}`);
console.log("");

if (dryRun) {
  console.log(`Dry run: ${planned.length} tag(s) would move. Re-run without --dry-run to apply.`);
  process.exit(0);
}

const failed = [];
let done = 0;

for (const p of planned) {
  if (!NPM_NAME.test(p.name)) {
    failed.push({ ...p, reason: "not a package name npm would accept" });
    continue;
  }
  process.stdout.write(`  ${p.name} ${p.tag} ... `);
  try {
    // stdio inherited so a 2FA prompt is visible and answerable. npm is
    // passkey-only here, and a prompt swallowed into a pipe would look like a
    // hang with no way to respond.
    npm(["dist-tag", "add", `${p.name}@${version}`, p.tag], { stdio: "inherit" });
    done++;
  } catch (error) {
    failed.push({ ...p, reason: `npm exited ${error.status ?? "non-zero"}` });
  }
}

console.log(`\n${done} moved, ${failed.length} failed, ${skipped.length} already correct.`);

if (failed.length > 0) {
  console.error("\nFailed:\n");
  for (const f of failed) console.error(`  ${f.name}  ${f.tag}  ${f.reason}`);
  console.error("\nRe-run to retry — moves already made are skipped as already correct.");
  process.exit(1);
}

// A package whose tags could not be read is one whose tag was not moved, and
// whose state is unknown. Exiting 0 here would report a complete run over an
// incomplete one, which is the failure this pair of scripts keeps being written
// to avoid.
if (unreadable.length > 0) {
  console.error(`\n${unreadable.length} package(s) went unread, so their tags were not moved.`);
  console.error("This run is incomplete. Re-run once the registry answers.");
  process.exit(1);
}

console.log("\nVerify with `pnpm check:dist-tags`.");
