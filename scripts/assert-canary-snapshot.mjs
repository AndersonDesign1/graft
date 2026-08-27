/**
 * Refuse to publish a canary that is not actually a snapshot.
 *
 * `changeset version --snapshot canary` does not fail when there are no
 * unreleased changesets. It warns, exits 0, and leaves every version untouched.
 * The publish that follows then sees real versions rather than snapshots, and
 * `changeset publish --tag canary` skips what the registry already has and
 * publishes what it does not — so a stable version lands on the canary
 * dist-tag, and for a package not yet on npm that stable version becomes its
 * first release under the wrong tag. The job reports success either way, which
 * is the failure mode where you test the wrong bytes and trust the result.
 *
 * So: after versioning, every publishable package must carry a snapshot
 * version. Anything else means no snapshot happened.
 *
 * Members come from pnpm-workspace.yaml rather than a hardcoded `packages/`,
 * because publishable packages do not have to live there and a guard that
 * silently skips one is worse than no guard.
 *
 * This asserts ALL publishable packages because .changeset/config.json sets
 * `fixed: [["@usegraft/*"]]`, which versions them together. Drop `fixed` and
 * only changed packages would snapshot, so this check must change with it.
 */
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** `changeset version --snapshot` always produces 0.0.0-<tag>-<timestamp>. */
const SNAPSHOT = /^0\.0\.0-/;

/**
 * The `packages:` globs from pnpm-workspace.yaml.
 *
 * Parsed here rather than shelling out to `pnpm list`: locating pnpm across
 * platforms needs `shell: true`, and Node deprecated passing args alongside it
 * (DEP0190). The block is a plain list, so reading it is smaller than the
 * subprocess it replaces.
 */
function workspaceGlobs() {
  const lines = readFileSync("pnpm-workspace.yaml", "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  const globs = [];
  for (let i = start + 1; start !== -1 && i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // the next top-level key ends the block
    const item = lines[i].match(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/);
    if (item) globs.push(item[1]);
  }
  if (globs.length === 0) {
    throw new Error("Parsed no workspace globs from pnpm-workspace.yaml. Refusing to guess.");
  }
  return globs;
}

function workspaceProjects() {
  const seen = new Set();
  const projects = [];
  for (const glob of workspaceGlobs()) {
    for (const manifest of globSync(join(glob, "package.json"))) {
      const dir = dirname(manifest);
      if (seen.has(dir)) continue;
      seen.add(dir);
      try {
        const pkg = JSON.parse(readFileSync(manifest, "utf8"));
        projects.push({ name: pkg.name, version: pkg.version, private: !!pkg.private });
      } catch {
        // A member without a readable manifest cannot be published either.
      }
    }
  }
  return projects;
}

const publishable = workspaceProjects().filter((p) => !p.private && p.name && p.version);

if (publishable.length === 0) {
  console.error("Found no publishable workspace packages. Refusing to publish.");
  process.exit(1);
}

const stable = publishable.filter((p) => !SNAPSHOT.test(p.version));
if (stable.length > 0) {
  console.error(
    `Refusing to publish a canary: ${stable.length} of ${publishable.length} package(s) still carry a real version.\n`,
  );
  for (const p of stable.slice(0, 8)) console.error(`  ${p.name}  ${p.version}`);
  if (stable.length > 8) console.error(`  …and ${stable.length - 8} more`);
  console.error(
    `
This almost always means there were no unreleased changesets, so
\`changeset version --snapshot canary\` warned and exited 0 without touching
anything. Publishing now would push those real versions to the canary tag.

Add a changeset for whatever you want to test, then dispatch again:

  pnpm changeset
`,
  );
  process.exit(1);
}

console.log(
  `Canary snapshot verified: ${publishable.length} package(s) at ${publishable[0].version}`,
);
