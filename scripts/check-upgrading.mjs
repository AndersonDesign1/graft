/**
 * Every breaking change gets an Upgrading entry before it ships.
 *
 * A changeset marks a breaking change with `**BREAKING:**`, or a qualified
 * `**BREAKING (panels embed only):**`. The changelog
 * page picks those up by itself, because it is generated from the packages'
 * CHANGELOG.md files. The Upgrading page is written by hand, and it is the page
 * that tells a reader what to change. 1.0.0-beta.9 shipped three breaking
 * changes with one Upgrading entry, because nothing compared the two.
 *
 * This reads the changesets that have not been released yet and the version
 * they will release as (the same release plan `changeset version` uses, so it
 * follows prerelease mode). For that version, `upgrading.mdx` must have a
 * `## <version>` section with at least one `**What to do:**` entry per
 * breaking changeset.
 *
 * Once `changeset version` consumes the changesets, there is nothing pending,
 * so the version pull request and everything after it pass.
 *
 *   node scripts/check-upgrading.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const upgradingPath = resolve(root, "examples/docs-site/content/docs/upgrading.mdx");
/** `**BREAKING:**`, or with a qualifier: `**BREAKING (panels embed only):**`. */
const BREAKING = /\*\*BREAKING(?: \([^)\n]*\))?:\*\*/;
const ENTRY = "**What to do:**";

/** The changesets whose summary marks a breaking change. */
export function breakingChangesets(changesets) {
  return changesets.filter((changeset) => BREAKING.test(changeset.summary));
}

/**
 * The body of the `## ` section whose heading names `version`, or null. A
 * heading can name more than one version ("1.0.0-beta.1 and 1.0.0-beta.2").
 */
export function sectionFor(mdx, version) {
  const lines = mdx.split("\n");
  const start = lines.findIndex((line) => {
    const heading = /^## (.+)$/.exec(line.trim());
    return heading !== null && heading[1].split(/,\s*|\s+and\s+/).includes(version);
  });
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** How many entries a section holds: one per `**What to do:**`. */
export function countEntries(section) {
  return section.split(ENTRY).length - 1;
}

/**
 * The first sentence after the marker, which can sit mid-summary, after the
 * changes that do not break anything.
 */
export function headline(changeset) {
  const marker = BREAKING.exec(changeset.summary);
  const afterMarker = marker
    ? changeset.summary.slice(marker.index + marker[0].length)
    : changeset.summary;
  const text = afterMarker.trim().split(/\n\s*\n/)[0] ?? "";
  const oneLine = text.replace(/\s+/g, " ");
  const sentence = /^.+?[.!?](?=\s|$)/.exec(oneLine);
  return sentence ? sentence[0] : oneLine;
}

/**
 * Problems for one upcoming version, as messages a person can act on. Empty
 * when the version has no breaking changesets or the page covers them.
 */
export function checkUpgrading({ version, changesets, mdx, pagePath = "upgrading.mdx" }) {
  const breaking = breakingChangesets(changesets);
  if (breaking.length === 0) return [];

  const listed = breaking.map(
    (changeset) => `  .changeset/${changeset.id}.md: ${headline(changeset)}`,
  );
  const section = sectionFor(mdx, version);
  if (section === null) {
    return [
      `${pagePath} has no "## ${version}" section, and ${version} has ${breaking.length} breaking change(s):`,
      ...listed,
      `Add "## ${version}" above the newest section, with one "${ENTRY}" entry for each.`,
    ];
  }
  const entries = countEntries(section);
  if (entries >= breaking.length) return [];
  return [
    `${pagePath} has ${entries} "${ENTRY}" entr${entries === 1 ? "y" : "ies"} under "## ${version}", and ${version} has ${breaking.length} breaking change(s):`,
    ...listed,
    `Add an entry under "## ${version}" for each one that is missing: what changed, why, then "${ENTRY}".`,
  ];
}

/** The pending changesets and the version they release as, from changesets itself. */
async function releasePlan() {
  // @changesets/get-release-plan comes with @changesets/cli, which is a root
  // dependency. Resolving it through the CLI keeps the two on one version.
  const fromCli = createRequire(
    createRequire(import.meta.url).resolve("@changesets/cli/package.json"),
  );
  const getReleasePlan = fromCli("@changesets/get-release-plan").default;
  const plan = await getReleasePlan(root);
  const versions = [
    ...new Set(
      plan.releases
        .filter((release) => release.type !== "none")
        .map((release) => release.newVersion),
    ),
  ];
  return { changesets: plan.changesets, versions };
}

async function main() {
  const { changesets, versions } = await releasePlan();
  const breaking = breakingChangesets(changesets);
  if (breaking.length === 0) {
    console.log("check:upgrading: no unreleased breaking changes.");
    return;
  }
  if (versions.length !== 1) {
    // `fixed` in .changeset/config.json keeps every package on one version.
    console.error(
      `check:upgrading: expected one upcoming version, found ${versions.join(", ") || "none"}. Check "fixed" in .changeset/config.json.`,
    );
    process.exitCode = 1;
    return;
  }
  const [version] = versions;
  const problems = checkUpgrading({
    version,
    changesets,
    mdx: readFileSync(upgradingPath, "utf8"),
    pagePath: relative(root, upgradingPath),
  });
  if (problems.length > 0) {
    console.error(`check:upgrading: ${problems.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check:upgrading: ${version} has ${breaking.length} breaking change(s), each with an Upgrading entry.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
