/**
 * `npm create graft [dir] [-- flags]`: runs `graft create` from the Graft CLI
 * this package depends on, with the same arguments. Everything lives in the
 * CLI, so `npx graft create` and `npm create graft` can never differ.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@usegraft/cli/package.json")), "dist", "index.js");
const result = spawnSync(process.execPath, [cli, "create", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
