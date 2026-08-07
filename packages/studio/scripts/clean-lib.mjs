/**
 * Remove the library build's own output, and nothing else.
 *
 * `dist/` holds two independent builds: tsup writes the server library and the
 * React embed entry as files directly inside it, and Vite writes the SPA into
 * `dist/ui/`. tsup's `clean` wipes the whole directory — including `dist/ui` —
 * so running `build:lib` on its own used to leave the Studio serving a 500
 * until someone remembered to rebuild the UI. Its glob form removes the
 * nested files too, so this deletes top-level files only and never recurses.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

let removed = 0;
try {
  for (const entry of readdirSync(dist)) {
    const path = join(dist, entry);
    // Directories are somebody else's output (dist/ui). Leave them alone.
    if (statSync(path).isDirectory()) continue;
    rmSync(path);
    removed++;
  }
} catch (error) {
  // A missing dist is the normal first-build case, not a failure.
  if (error.code !== "ENOENT") throw error;
}

console.log(`clean:lib — removed ${removed} file(s) from dist/`);
