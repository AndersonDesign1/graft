/**
 * Which packages this repo publishes, and which channel it publishes them to.
 *
 * Four scripts need this and three had grown their own byte-identical copy of
 * the pnpm-workspace parser: assert-canary-snapshot, assert-canary-published,
 * check-dist-tags. That is the shape of drift this repo already writes checks
 * against elsewhere — the copies agree until one is fixed and the others are
 * not, and the ones left behind keep guarding the release with an answer that
 * has quietly stopped being true.
 *
 * Members come from pnpm-workspace.yaml rather than a hardcoded `packages/`,
 * because a publishable package does not have to live there and a guard that
 * silently skips one is worse than no guard.
 */
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The `packages:` globs from pnpm-workspace.yaml.
 *
 * Parsed here rather than shelled out to `pnpm list`: locating pnpm across
 * platforms needs `shell: true`, and Node deprecated passing args alongside it
 * (DEP0190). The block is a plain list, so reading it is smaller than the
 * subprocess it replaces.
 */
export function workspaceGlobs() {
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

/** Every workspace member, private ones included, as `{name, version, private}`. */
export function workspaceProjects() {
  const seen = new Set();
  const projects = [];
  for (const glob of workspaceGlobs()) {
    for (const manifestPath of globSync(join(glob, "package.json"))) {
      const dir = dirname(manifestPath);
      if (seen.has(dir)) continue;
      seen.add(dir);
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        projects.push({
          name: manifest.name,
          version: manifest.version,
          private: manifest.private === true,
        });
      } catch {
        // A member without a readable manifest cannot be published either.
      }
    }
  }
  return projects;
}

/** The members npm would actually receive. */
export function publishablePackages() {
  return workspaceProjects()
    .filter((p) => !p.private && p.name && p.version)
    .map(({ name, version }) => ({ name, version }));
}

/**
 * The one version this release carries.
 *
 * `.changeset/config.json` sets `fixed: [["@usegraft/*"]]`, so every publishable
 * package moves together and one version describes the release. Disagreement
 * means a partial `changeset version` run, which is worth stopping on before
 * anything is judged against it.
 */
export function releaseVersion(packages) {
  const versions = [...new Set(packages.map((p) => p.version))];
  if (versions.length > 1) {
    throw new Error(
      `Workspace packages disagree about the version: ${versions.join(", ")}.\n` +
        "`fixed` should keep these identical. Refusing to act on a guess.",
    );
  }
  return versions[0];
}

/**
 * Where `latest` belongs, and why.
 *
 * In pre mode the answer is the prerelease, not the newest stable. The 0.x line
 * is deprecated and the beta is what the documentation describes, so a bare
 * install has to reach it — that is the whole reason `@beta` was removed from
 * every install command. Reading `mode` matters: `changeset pre exit` leaves
 * pre.json in place with `mode: "exit"`, which means stable, and treating that
 * as beta would pin `latest` to a prerelease after graduating away from one.
 */
export function releaseChannel() {
  let pre;
  try {
    pre = JSON.parse(readFileSync(".changeset/pre.json", "utf8"));
  } catch {
    return { name: "stable", tags: ["latest"] };
  }
  if (pre.mode === "exit" || pre.mode === "none") return { name: "stable", tags: ["latest"] };
  return { name: pre.tag, tags: ["latest", pre.tag] };
}

/**
 * The grammar npm accepts for a package name.
 *
 * npm has to be reached through a shell — `execFileSync("npm", …)` cannot spawn
 * it on Windows, where it is a `.cmd` shim, and naming `npm.cmd` does not
 * survive Git Bash's POSIX-shaped PATH — and `shell: true` alongside an args
 * array is the pair Node deprecated in DEP0190 for concatenating rather than
 * escaping. So commands are built as one string, and the only interpolated
 * value is checked against this first. A name that fails it could not have been
 * published anyway, so refusing it loses nothing.
 */
export const NPM_NAME = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;
