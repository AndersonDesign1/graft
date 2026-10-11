/**
 * The changelog page is generated, not written.
 *
 * Every published package already has a CHANGELOG.md that changesets writes
 * from the changesets each PR adds. The packages release together (one fixed
 * group), so a single change appears in every CHANGELOG it touched, word for
 * word. This merges the 21 files into one page: one section per release, each
 * change listed once with the packages it touched and a link to its commit.
 *
 * Release dates are the npm publish dates, kept in scripts/changelog-dates.json
 * so the check needs no git history or network. Writing the page reads the
 * publish times from the registry and corrects that file, so a release whose
 * version PR sat unmerged for days gets its real date at the next run. A
 * version not on npm yet (a fresh `changeset version`) gets today's date until
 * then. Offline, the stored dates are used as they are.
 *
 *   node scripts/gen-changelog.mjs           # write the page (and any new date)
 *   node scripts/gen-changelog.mjs --check   # fail if the page is stale
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const OUT = resolve(root, "examples/docs-site/content/docs/changelog.mdx");
const DATES = resolve(root, "scripts/changelog-dates.json");
const REPO = "https://github.com/AndersonDesign1/graft";

const check = process.argv.includes("--check");

/** Each published package's name and CHANGELOG, in name order. */
function readChangelogs() {
  const dir = resolve(root, "packages");
  return readdirSync(dir)
    .map((name) => resolve(dir, name))
    .filter((pkgDir) => existsSync(resolve(pkgDir, "CHANGELOG.md")))
    .map((pkgDir) => {
      const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));
      return {
        name: pkg.name,
        private: pkg.private === true,
        text: readFileSync(resolve(pkgDir, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n"),
      };
    })
    .filter((pkg) => !pkg.private)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse one CHANGELOG into { version, kind, sha, body } entries.
 *
 * changesets writes `## <version>`, then `### Major|Minor|Patch Changes`, then
 * one `- <sha>: <text>` item per changeset with its continuation lines
 * indented two spaces. Dependency-bump items only restate other packages'
 * versions, so they are dropped.
 */
function parseChangelog(text) {
  const entries = [];
  let version;
  let kind;
  let item;
  const flush = () => {
    if (!item) return;
    // Early releases nested the bumps under a real change instead
    // (`  - @usegraft/assets@0.1.1`), so drop those lines from inside a body too.
    const body = item.lines
      .filter((line) => !/^\s+- @usegraft\/[\w-]+@\S+$/.test(line))
      .join("\n")
      .replace(/\s+$/, "");
    // A bare `- @usegraft/core@1.0.0-beta.2` is the same restatement, written
    // without the "Updated dependencies" line when a package only re-released.
    if (!/^Updated dependencies/.test(body) && !/^@usegraft\/[\w-]+@\S+$/.test(body)) {
      entries.push({ version, kind, sha: item.sha, body });
    }
    item = undefined;
  };
  for (const line of text.split("\n")) {
    const versionMatch = /^## (\S+)/.exec(line);
    if (versionMatch) {
      flush();
      version = versionMatch[1];
      kind = undefined;
      continue;
    }
    const kindMatch = /^### (Major|Minor|Patch) Changes/.exec(line);
    if (kindMatch) {
      flush();
      kind = kindMatch[1].toLowerCase();
      continue;
    }
    if (!version || !kind) continue;
    if (line.startsWith("- ")) {
      flush();
      const shaMatch = /^- ([0-9a-f]{7,40}): (.*)$/.exec(line);
      item = shaMatch
        ? { sha: shaMatch[1], lines: [shaMatch[2]] }
        : { sha: null, lines: [line.slice(2)] };
      continue;
    }
    if (item) item.lines.push(line);
  }
  flush();
  return entries;
}

/** Semver order, newest first: a prerelease sorts before its release. */
function compareVersionsDesc(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split("-", 2);
    return { nums: core.split(".").map(Number), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return y.nums[i] - x.nums[i];
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return -1;
  if (!y.pre) return 1;
  const xp = x.pre.split(".");
  const yp = y.pre.split(".");
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    if (xp[i] === undefined) return 1;
    if (yp[i] === undefined) return -1;
    const xn = Number(xp[i]);
    const yn = Number(yp[i]);
    if (!Number.isNaN(xn) && !Number.isNaN(yn) && xn !== yn) return yn - xn;
    if (xp[i] !== yp[i]) return yp[i].localeCompare(xp[i]);
  }
  return 0;
}

/**
 * Changeset text was written for GitHub and npm, so it can hold characters MDX
 * parses as syntax: `<slug>` opens a JSX element and `{ … }` is an expression
 * that @usegraft/mdx-safety refuses. Escape `<` and `{` everywhere except in
 * code: fenced blocks and inline spans. A scan, not a regex replace, for the
 * reason gen-error-docs.mjs gives.
 */
function escapeMdx(text) {
  const lines = text.split("\n");
  let inFence = false;
  // An inline span opened by a run of N backticks closes at the next run of
  // exactly N, and may wrap onto the next line: changesets are hard-wrapped
  // prose. A blank line ends the paragraph, and with it any unclosed span.
  let openRun = 0;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        openRun = 0;
        return line;
      }
      if (inFence) return line;
      if (line.trim() === "") {
        openRun = 0;
        return line;
      }
      let out = "";
      for (let i = 0; i < line.length; ) {
        if (line[i] === "`") {
          let run = 0;
          while (line[i + run] === "`") run++;
          if (openRun === 0) openRun = run;
          else if (run === openRun) openRun = 0;
          out += "`".repeat(run);
          i += run;
          continue;
        }
        const ch = line[i];
        out += openRun === 0 && (ch === "<" || ch === "{") ? `\\${ch}` : ch;
        i++;
      }
      return out;
    })
    .join("\n");
}

/** Which group a change goes in. Pre-1.0, breaks ship as minors, so read the text too. */
function group(kind, body) {
  // Older entries write the marker as **BREAKING:**.
  if (kind === "major" || /\*\*Breaking/i.test(body)) return "breaking";
  return kind === "minor" ? "features" : "fixes";
}

const GROUPS = [
  ["breaking", "Breaking changes"],
  ["features", "Features"],
  ["fixes", "Fixes"],
];

// Merge: one entry per changeset, with every package it touched.
const releases = new Map();
for (const pkg of readChangelogs()) {
  for (const entry of parseChangelog(pkg.text)) {
    if (!releases.has(entry.version)) releases.set(entry.version, new Map());
    const changes = releases.get(entry.version);
    const key = `${entry.sha ?? ""}\n${entry.body}`;
    const existing = changes.get(key);
    const short = pkg.name.replace(/^@usegraft\//, "");
    if (existing) {
      existing.packages.add(short);
      // A changeset can be a patch for one package and a minor for another.
      if (existing.kind === "patch" || entry.kind === "major") existing.kind = entry.kind;
    } else {
      changes.set(key, { ...entry, packages: new Set([short]) });
    }
  }
}

const versions = [...releases.keys()].sort(compareVersionsDesc);

/**
 * Publish dates from the registry, keyed by version, or null when it cannot be
 * reached. One package is enough: the fixed group publishes every version of
 * every package in the same run.
 */
async function publishDates() {
  try {
    const response = await fetch("https://registry.npmjs.org/@usegraft/cli", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`registry answered ${response.status}`);
    const { time } = await response.json();
    return Object.fromEntries(
      Object.entries(time ?? {}).map(([version, iso]) => [version, String(iso).slice(0, 10)]),
    );
  } catch (error) {
    console.warn(
      `Could not read publish dates from npm (${error.message}); keeping the stored ones.`,
    );
    return null;
  }
}

// Dates: the stored ones, corrected from npm when writing, and today for a
// version npm does not have yet.
const dates = existsSync(DATES) ? JSON.parse(readFileSync(DATES, "utf8")) : {};
const before = JSON.stringify(dates);
const today = new Date().toISOString().slice(0, 10);
if (check) {
  const missing = versions.filter((v) => !dates[v]);
  if (missing.length > 0) {
    console.error(`No release date for ${missing.join(", ")} in scripts/changelog-dates.json.`);
    console.error("Run: node scripts/gen-changelog.mjs");
    process.exit(1);
  }
} else {
  const published = await publishDates();
  for (const v of versions) dates[v] = published?.[v] ?? dates[v] ?? today;
}

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

/** One list item: the changeset text, then the packages and the commit. */
function renderEntry(entry) {
  const [first, ...rest] = escapeMdx(entry.body).split("\n");
  const packages = [...entry.packages]
    .sort()
    .map((p) => `\`${p}\``)
    .join(", ");
  const commit = entry.sha ? ` · [${entry.sha}](${REPO}/commit/${entry.sha})` : "";
  return [`- ${first}`, ...rest, "", `  ${packages}${commit}`].join("\n");
}

function renderRelease(version) {
  const entries = [...releases.get(version).values()];
  const sections = GROUPS.map(([id, title]) => {
    const inGroup = entries.filter((e) => group(e.kind, e.body) === id);
    if (inGroup.length === 0) return null;
    return [`### ${title}`, "", inGroup.map(renderEntry).join("\n\n")].join("\n");
  }).filter(Boolean);
  return [
    `## ${version}`,
    "",
    `Released ${formatDate(dates[version])}.`,
    "",
    ...sections.flatMap((s) => [s, ""]),
  ]
    .join("\n")
    .trimEnd();
}

const changeCount = versions.reduce((n, v) => n + releases.get(v).size, 0);

// The "do not edit" banner lives in the frontmatter, as YAML comments: an MDX
// comment is a JSX expression, which mdx-safety refuses (see gen-error-docs.mjs).
const page = `---
# GENERATED FILE. Do not edit.
# Source: packages/*/CHANGELOG.md (written by changesets) and scripts/changelog-dates.json
# Regenerate: node scripts/gen-changelog.mjs
title: Changelog
description: "Every change in every Graft release, newest first, with the packages it touched. Dependency-only updates are left out."
section: Reference
order: 8
---

<p className="kicker">Every change in every release, newest first, except dependency-only updates.</p>

All Graft packages release together under one version number, so each release
below covers all of them. Each change names the packages it touched and links to
its commit. To move a project across a breaking change, follow
[Upgrading](/docs/upgrading), which says what to change for each one.

There are ${versions.length} releases and ${changeCount} changes on this page.

${versions.map(renderRelease).join("\n\n")}
`;

if (check) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    console.error(`Missing: ${OUT}`);
    console.error("Run: node scripts/gen-changelog.mjs");
    process.exit(1);
  }
  if (current.replace(/\r\n/g, "\n") !== page) {
    console.error("The changelog page is stale.");
    console.error("A CHANGELOG.md changed and docs/changelog.mdx did not.");
    console.error("Run: node scripts/gen-changelog.mjs");
    process.exit(1);
  }
  console.log(`Changelog is current (${versions.length} releases, ${changeCount} changes).`);
} else {
  writeFileSync(OUT, page, "utf8");
  if (JSON.stringify(dates) !== before) {
    writeFileSync(DATES, `${JSON.stringify(dates, null, 2)}\n`, "utf8");
  }
  console.log(`Wrote ${OUT} (${versions.length} releases, ${changeCount} changes).`);
}
