/**
 * Refuse to publish a canary that is not actually a snapshot.
 *
 * `changeset version --snapshot canary` exits 0 and changes nothing when there
 * are no unreleased changesets. It only warns. The publish that follows then
 * sees real versions rather than snapshots, and `changeset publish --tag canary`
 * happily pushes a STABLE version to the canary dist-tag — or, for a package not
 * yet on the registry, makes that stable version its first release under the
 * wrong tag. The job reports success either way.
 *
 * So: after versioning, every publishable package must carry a snapshot version.
 * Anything else means no snapshot happened, and publishing would be wrong.
 *
 * This asserts ALL of them because .changeset/config.json sets
 * `fixed: [["@usegraft/*"]]`, which versions every package together. Drop
 * `fixed` and only changed packages would snapshot, so this check would need to
 * change with it. Failing closed is the point: a canary that quietly published
 * nothing is indistinguishable from one that worked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOT = /^0\.0\.0-[a-z0-9.-]+$/i;
const PACKAGES = "packages";

const publishable = [];
for (const dir of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, dir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8"));
  } catch {
    continue;
  }
  if (pkg.private) continue;
  publishable.push({ name: pkg.name, version: pkg.version });
}

if (publishable.length === 0) {
  console.error("No publishable packages found under packages/. Refusing to publish.");
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
