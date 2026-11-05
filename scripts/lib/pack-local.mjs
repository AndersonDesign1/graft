/**
 * Pack the workspace's published packages as npm would see them, so an app
 * outside the workspace can install this checkout instead of the registry.
 *
 * `pnpm pack` rewrites `workspace:*` to a version number, and that version
 * resolves to whatever is on npm. So the caller also needs `overrides`: every
 * `@usegraft/*` name pointing at its tarball, transitive installs included.
 * `packLocal` returns that map.
 *
 * It packs the named packages and every workspace package they depend on,
 * and nothing else. Each one must be built first: a tarball holds `dist/`,
 * not the source.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Every published workspace package, by name: its folder and manifest. */
function workspacePackages() {
  const found = new Map();
  for (const folder of readdirSync(join(repo, "packages"))) {
    const dir = join(repo, "packages", folder);
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.private || !manifest.name?.startsWith("@usegraft/")) continue;
    found.set(manifest.name, { dir, manifest });
  }
  return found;
}

/**
 * Pack `roots` and their workspace dependencies into `outDir`. Returns
 * `{ "@usegraft/core": "file:/…/usegraft-core-1.0.0.tgz", … }`.
 */
export function packLocal(outDir, roots) {
  const workspace = workspacePackages();
  // A name with no package here would install from the registry, and the
  // caller would be testing the published package, not this checkout.
  const unknown = roots.filter((name) => !workspace.has(name));
  if (unknown.length > 0) {
    throw new Error(`No published workspace package named ${unknown.join(", ")}.`);
  }
  const wanted = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (wanted.has(name) || !workspace.has(name)) continue;
    wanted.add(name);
    const { manifest } = workspace.get(name);
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      queue.push(...Object.keys(manifest[field] ?? {}).filter((dep) => workspace.has(dep)));
    }
  }

  mkdirSync(outDir, { recursive: true });
  const overrides = {};
  for (const name of [...wanted].sort()) {
    const { dir, manifest } = workspace.get(name);
    const shipsDist = (manifest.files ?? []).includes("dist");
    if (shipsDist && !existsSync(join(dir, "dist"))) {
      throw new Error(`${name} has no dist/. Build it before packing.`);
    }
    const result = spawnSync("pnpm", ["pack", "--pack-destination", outDir], {
      cwd: dir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      throw new Error(`pnpm pack failed for ${name}:\n${result.stderr}`);
    }
    // pnpm prints the tarball's path on its last line.
    const tarball = result.stdout.trim().split("\n").at(-1);
    overrides[name] = `file:${resolve(outDir, tarball)}`;
  }
  return overrides;
}
