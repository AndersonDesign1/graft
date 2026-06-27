/**
 * Apply pending Drizzle migrations from ./drizzle to DATABASE_URL.
 * Run: pnpm --filter @graft/db db:migrate   (loads repo-root .env)
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (expected via --env-file=.env)");
  process.exit(1);
}

const isNeon = /\.neon\.tech/.test(url);
const sql = postgres(url, {
  ssl: isNeon || /sslmode=require/.test(url) ? "require" : false,
  prepare: !isNeon,
  max: 1,
});

try {
  await migrate(drizzle(sql), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("✅ migrations applied");
} catch (err) {
  console.error("migration failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
