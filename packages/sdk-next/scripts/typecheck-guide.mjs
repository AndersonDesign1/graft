/**
 * Type-check the Next.js guide's code blocks (guide/) against the Next this
 * package develops on. The compat apps (compat/next14, next15, next16) check
 * the same blocks against each supported major.
 *
 * The blocks that only exist on Next 16 live in guide/next16/ and are added
 * when the installed major is 16 or later.
 *
 * Paths resolve from this file, so the script gives the same answer from any
 * working directory.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const { version } = createRequire(import.meta.url)("next/package.json");
const major = Number.parseInt(version, 10);
const project = fileURLToPath(
  new URL(
    major >= 16 ? "../guide/tsconfig.next16.json" : "../guide/tsconfig.json",
    import.meta.url,
  ),
);

console.log(`Type-checking the Next.js guide against next@${version} (${project})`);
// Through pnpm so the workspace's `tsc` runs, not one on the PATH, and with
// shell: true so the shim resolves on Windows. The only argument that varies
// is a path built above, quoted for the shell.
const result = spawnSync(`pnpm exec tsc --noEmit -p ${JSON.stringify(project)}`, {
  cwd: packageRoot,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
