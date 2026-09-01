/**
 * One GitHub Release per version, instead of twenty-one.
 *
 * `.changeset/config.json` sets `fixed: [["@usegraft/*"]]`, so every package
 * moves in lockstep — 0.2.0 is one release of one product. changesets/action
 * does not know that: it tags and releases each package separately, so a single
 * version produced 21 tags and 21 GitHub Releases, with one arbitrarily flagged
 * "Latest" because GitHub picks by recency. Tags fragmented the history rather
 * than grouping it.
 *
 * This adds the grouping release: one `v<version>` tag and one Release whose
 * body is every package's changelog entry for that version, collected. The
 * per-package tags stay — they are what `npm view` and provenance point at, and
 * deleting them would break links that already exist.
 *
 * Idempotent: an existing `v<version>` release is left alone rather than
 * duplicated, so a re-run after a partial publish is safe.
 *
 *   node scripts/group-release.mjs            create it for the current version
 *   node scripts/group-release.mjs --dry-run  print what it would create
 *
 * Needs GITHUB_TOKEN with `contents: write`.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY ?? "AndersonDesign1/graft";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

/** Publishable workspace members, from pnpm-workspace.yaml's `packages:` globs. */
function members() {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  const globs = [];
  for (let i = start + 1; i < lines.length && /^\s*-\s/.test(lines[i]); i += 1) {
    globs.push(
      lines[i]
        .replace(/^\s*-\s*/, "")
        .replace(/^["']|["']$/g, "")
        .trim(),
    );
  }
  const out = [];
  for (const glob of globs) {
    for (const dir of globSyncDirs(glob)) {
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.private || !pkg.name || !pkg.version) continue;
      out.push({ name: pkg.name, version: pkg.version, dir });
    }
  }
  return out;
}

function globSyncDirs(glob) {
  // Only the shapes pnpm-workspace actually uses here: "packages/*", "examples/*".
  const [base] = glob.split("/*");
  const baseDir = join(root, base);
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(baseDir, e.name));
}

const pkgs = members();
if (pkgs.length === 0) {
  console.error("group-release: found no publishable workspace packages.");
  process.exit(1);
}

// `fixed` means one version. If they disagree, something versioned them apart
// and a single grouping release would be a lie about what shipped.
const versions = [...new Set(pkgs.map((p) => p.version))];
if (versions.length !== 1) {
  console.error(
    `group-release: packages are not on one version, so there is no single release to group:\n` +
      versions
        .map(
          (v) =>
            `  ${v}: ${pkgs
              .filter((p) => p.version === v)
              .map((p) => p.name)
              .join(", ")}`,
        )
        .join("\n"),
  );
  process.exit(1);
}
const version = versions[0];
const tag = `v${version}`;

/** That version's section from a package's CHANGELOG.md, if it has one. */
function changelogSection(dir) {
  const path = join(dir, "CHANGELOG.md");
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  const start = text.indexOf(`\n## ${version}\n`);
  if (start === -1) return "";
  const after = text.indexOf("\n## ", start + 1);
  return text.slice(start + `\n## ${version}\n`.length, after === -1 ? undefined : after).trim();
}

const sections = pkgs
  .map((p) => ({ name: p.name, body: changelogSection(p.dir) }))
  .filter((s) => s.body.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

const body = [
  `All \`@usegraft/*\` packages release together at \`${version}\` — they are one product on one`,
  `version line (\`fixed\` in .changeset/config.json), so this is the release for all ${pkgs.length}.`,
  "",
  "```sh",
  `npm i @usegraft/cli@${version}`,
  "```",
  "",
  ...(sections.length === 0
    ? ["_No package changelog entries found for this version._"]
    : sections.flatMap((s) => [`## ${s.name}`, "", s.body, ""])),
].join("\n");

if (dryRun) {
  console.log(`group-release: would create ${tag} for ${pkgs.length} packages\n`);
  console.log(body.slice(0, 1200));
  process.exit(0);
}

const ghEnv = { ...process.env };
if (token) ghEnv.GH_TOKEN = token;

const gh = (args, input) =>
  execFileSync("gh", args, { cwd: root, input, encoding: "utf8", env: ghEnv });

try {
  gh(["release", "view", tag, "--repo", repo, "--json", "tagName"]);
  console.log(`group-release: ${tag} already exists — leaving it alone.`);
  process.exit(0);
} catch {
  // Not found is the ordinary path.
}

gh(
  ["release", "create", tag, "--repo", repo, "--title", `Graft ${version}`, "--notes-file", "-"],
  body,
);
console.log(`group-release: created ${tag} covering ${pkgs.length} packages.`);
