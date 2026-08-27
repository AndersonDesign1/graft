/**
 * Per-package line coverage, with a floor each package must not fall below.
 *
 * Deliberately per-package rather than one repo-wide number. A single figure
 * hides exactly what matters here: `core` sits above 95% while `studio` — the
 * package with the most source files, and the one where the cross-document
 * overwrite lived — is far lower. Averaging those tells you nothing you can act
 * on.
 *
 * The floors below are the measured values rounded down, not aspirations. They
 * are a ratchet: they exist to stop coverage sliding, and you raise one when
 * you have earned it. Raising them all to 90 today would just mean disabling
 * the check by Friday.
 *
 * Run: node scripts/coverage.mjs [--update]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const floorsPath = join(root, "scripts", "coverage-floors.json");
const floors = JSON.parse(readFileSync(floorsPath, "utf8"));
const update = process.argv.includes("--update");
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const results = [];
let failed = false;

for (const [pkg, floor] of Object.entries(floors)) {
  try {
    execFileSync(
      pnpmBin,
      [
        "--filter",
        `@usegraft/${pkg}`,
        "exec",
        "vitest",
        "run",
        "--coverage.enabled",
        "--coverage.provider=v8",
        "--coverage.reporter=json-summary",
        "--coverage.reportsDirectory=.cov",
      ],
      // Not `shell: true`: passing args through a shell concatenates rather
      // than escapes them. Resolve the platform's binary name instead.
      { cwd: root, stdio: "ignore" },
    );
  } catch {
    // A failing suite is the test job's problem to report, not this one's.
  }

  const summary = join(root, "packages", pkg, ".cov", "coverage-summary.json");
  if (!existsSync(summary)) {
    console.error(`${pkg}: no coverage summary produced`);
    failed = true;
    continue;
  }

  const pct = JSON.parse(readFileSync(summary, "utf8")).total.lines.pct;
  const ok = pct >= floor;
  if (!ok) failed = true;
  results.push({ pkg, pct, floor, ok });
  if (update) floors[pkg] = Math.floor(pct);
}

const width = Math.max(...results.map((r) => r.pkg.length));
for (const { pkg, pct, floor, ok } of results) {
  const mark = ok ? "ok  " : "BELOW";
  console.log(`${mark} ${pkg.padEnd(width)}  ${String(pct).padStart(6)}%  (floor ${floor}%)`);
}

if (update) {
  writeFileSync(floorsPath, `${JSON.stringify(floors, null, 2)}\n`);
  console.log("\nFloors updated to the measured values.");
  process.exit(0);
}

if (failed) {
  console.error("\nCoverage fell below a floor. Add tests, or lower the floor deliberately");
  console.error("in scripts/coverage-floors.json and say why in the commit message.");
  process.exit(1);
}
console.log("\nEvery package is at or above its floor.");
