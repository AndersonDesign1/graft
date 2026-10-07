/**
 * Type-check the Next.js guide's code blocks (guide/) against the Next that is
 * installed. CI swaps that install across 14, 15 and 16, so the same command
 * proves the guide compiles on each.
 *
 * The blocks that only exist on Next 16 live in guide/next16/ and are added
 * when the installed major is 16 or later.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const { version } = createRequire(import.meta.url)("next/package.json");
const major = Number.parseInt(version, 10);
const project = major >= 16 ? "guide/tsconfig.next16.json" : "guide/tsconfig.json";

console.log(`Type-checking the Next.js guide against next@${version} (${project})`);
// shell: true so the workspace's `tsc` shim resolves on Windows too. The
// arguments are fixed strings, never input.
const result = spawnSync("tsc", ["--noEmit", "-p", project], { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
