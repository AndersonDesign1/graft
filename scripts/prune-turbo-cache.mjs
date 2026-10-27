/**
 * Keep only the turbo cache entries this CI job used, so the cache it saves
 * stays the size of one build instead of growing with every run.
 *
 * CI restores `.turbo/cache` from an earlier run, turbo adds an entry for each
 * task it runs, and the job saves the directory again. Without this, every save
 * would carry every entry ever restored, and the cache would grow without
 * bound until it evicted itself and everything else.
 *
 * Turbo records the hash of every task it ran or replayed in its run summaries
 * (`.turbo/runs/*.json`, written when TURBO_RUN_SUMMARY=true). An entry whose
 * hash no summary names was not used by this job, so it is deleted. With no
 * summaries at all, nothing is deleted: an empty list means "unknown", not
 * "nothing used".
 *
 * Run: node scripts/prune-turbo-cache.mjs
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cacheDir = join(root, ".turbo", "cache");
const runsDir = join(root, ".turbo", "runs");

if (!existsSync(cacheDir) || !existsSync(runsDir)) {
  console.log("No turbo cache or run summaries; nothing to prune.");
  process.exit(0);
}

const used = new Set();
for (const name of readdirSync(runsDir)) {
  if (!name.endsWith(".json")) continue;
  const summary = JSON.parse(readFileSync(join(runsDir, name), "utf8"));
  for (const task of summary.tasks ?? []) used.add(task.hash);
}

if (used.size === 0) {
  console.log("The run summaries name no tasks; keeping the whole cache.");
  process.exit(0);
}

// Entries are `<hash>.tar.zst`, `<hash>-meta.json` and `<hash>-manifest.json`.
const hashOf = (file) => file.split(/[.-]/)[0];
let kept = 0;
let removed = 0;
let removedBytes = 0;
for (const file of readdirSync(cacheDir)) {
  const path = join(cacheDir, file);
  if (used.has(hashOf(file))) {
    kept += 1;
    continue;
  }
  removedBytes += statSync(path).size;
  rmSync(path, { recursive: true, force: true });
  removed += 1;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(
  `Turbo cache: kept ${kept} files for ${used.size} tasks, removed ${removed} (${mb(removedBytes)} MB).`,
);
