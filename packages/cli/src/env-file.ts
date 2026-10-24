import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The nearest .env walking up from `startDir` (the repo-root .env in the
 * monorepo case), or undefined. Kept free of heavy imports, so `run()` can
 * read it before any command module loads.
 */
export function findProjectEnvFile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
