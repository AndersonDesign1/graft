/**
 * `graft add` COPIES registry primitives into a project — that is the shadcn
 * model, and the duplication between packages/registry/registry/<item>/graft/
 * and examples/landing-page/graft/ is the mechanic being demonstrated, not
 * something to deduplicate away.
 *
 * The real hazard is drift: a security fix to a primitive that never reaches
 * the copy the examples ship and readers copy from. This asserts they match
 * byte for byte.
 *
 * Run: node scripts/check-registry-drift.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const registryRoot = join(root, "packages", "registry", "registry");
const exampleGraft = join(root, "examples", "landing-page", "graft");

const drifted = [];
const checked = [];

for (const item of readdirSync(registryRoot, { withFileTypes: true })) {
  if (!item.isDirectory()) continue;
  const sourceDir = join(registryRoot, item.name, "graft");
  if (!existsSync(sourceDir)) continue;

  for (const file of readdirSync(sourceDir)) {
    if (!file.endsWith(".ts")) continue;
    const source = join(sourceDir, file);
    const copy = join(exampleGraft, file);
    // A primitive the example has not adopted is fine; only adopted copies
    // are required to match.
    if (!existsSync(copy)) continue;

    checked.push(file);
    if (readFileSync(source, "utf8") !== readFileSync(copy, "utf8")) {
      drifted.push({ file, source, copy });
    }
  }
}

if (drifted.length > 0) {
  console.error("Registry primitives have drifted from the copies the example ships:\n");
  for (const { file, source, copy } of drifted) {
    console.error(`  ${file}`);
    console.error(`    source: ${source}`);
    console.error(`    copy:   ${copy}`);
  }
  console.error(
    "\nFix the primitive, then copy it over the example's version. A fix that lands" +
      "\nin only one of the two is how a patched vulnerability ships unpatched.",
  );
  process.exit(1);
}

console.log(`Registry copies match their sources (${checked.length} file(s) checked).`);
