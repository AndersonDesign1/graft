/**
 * Mutation testing for one package: change the code in small ways (flip a
 * condition, drop a list entry, empty a string) and see whether any test
 * fails. A change no test notices is behavior no test checks, whatever the
 * coverage figure says. `mdx-safety` had 94% line coverage while dropping
 * `embed` from the list of elements it refuses failed nothing.
 *
 * Run: pnpm mutation <package> [file-glob] [--ignore-static]
 *   pnpm mutation mdx-safety
 *   pnpm mutation core src/functions-handler.ts
 *   pnpm mutation mcp --ignore-static
 *
 * Unit tests only (no RUN_INTEGRATION), so code that only a live database
 * reaches reports as uncovered. Slow by nature: minutes for a small package.
 *
 * Three settings are not Stryker's defaults, and all are load-bearing here:
 *   - `inPlace`: a copied sandbox breaks each package's relative
 *     `extends: "../../tsconfig.base.json"`. Stryker restores the files when
 *     it finishes; if it is killed instead, `git checkout -- packages/<name>`.
 *   - the runner is passed by path: Stryker looks for plugins next to the
 *     package, and they are installed at the root.
 *   - `--ignore-static` skips code that runs at import (constants, tables).
 *     Each such mutant needs the whole suite, which was 89% of the time on
 *     `mcp`. It is off by default because those tables are often the point:
 *     the list of elements `mdx-safety` refuses is one.
 *
 * Read the result with care. A test that "killed nothing" may only have been
 * beaten to it: Stryker stops at the first test that catches each mutant. To
 * prune, delete the candidate and confirm the score does not drop.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const ignoreStatic = args.includes("--ignore-static");
const [name, glob] = args.filter((arg) => !arg.startsWith("--"));
if (!name) {
  console.error("usage: pnpm mutation <package> [file-glob] [--ignore-static]");
  process.exit(2);
}
const dir = join(root, "packages", name);
if (!existsSync(join(dir, "package.json"))) {
  console.error(`No package at packages/${name}.`);
  process.exit(2);
}

const require = createRequire(join(root, "package.json"));
const runner = realpathSync(require.resolve("@stryker-mutator/vitest-runner"));
const out = mkdtempSync(join(tmpdir(), `graft-mutation-${name}-`));
const config = join(out, "stryker.json");
writeFileSync(
  config,
  JSON.stringify({
    testRunner: "vitest",
    plugins: [runner],
    mutate: glob
      ? [glob]
      : ["src/**/*.ts", "src/**/*.tsx", "!src/**/*.test.ts", "!src/**/*.test.tsx"],
    coverageAnalysis: "perTest",
    ignoreStatic,
    inPlace: true,
    reporters: ["clear-text", "json"],
    jsonReporter: { fileName: join(out, "report.json") },
  }),
);

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["exec", "stryker", "run", config], { cwd: dir, stdio: "inherit" });
console.log(`\nFull report: ${join(out, "report.json")}`);
process.exit(result.status ?? 1);
