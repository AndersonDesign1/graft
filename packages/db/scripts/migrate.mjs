/**
 * Apply pending schema migrations to DATABASE_URL.
 * Run: pnpm --filter @usegraft/db db:migrate   (loads repo-root .env)
 *
 * Thin wrapper over the same `runMigrations` that `graft db migrate` calls, so
 * the monorepo exercises the path npm consumers get rather than a parallel one.
 */
import { runMigrations } from "../dist/index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (expected via --env-file=.env)");
  process.exit(1);
}

try {
  const { applied } = await runMigrations(url);
  console.log(
    applied.length === 0
      ? "✅ schema already up to date"
      : `✅ applied ${applied.length} migration(s): ${applied.join(", ")}`,
  );
} catch (err) {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
