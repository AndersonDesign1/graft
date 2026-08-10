/**
 * graft db migrate — bring a Postgres database's schema up to date.
 *
 * The generated SQL ships inside @usegraft/db, so this works for a project
 * installed from npm: no monorepo tooling, no drizzle-kit, no checked-out
 * migrations folder. It is the first command a Postgres-tier project runs.
 *
 * Applies by default (see the reasoning in @usegraft/db's migrate.ts: this is
 * additive, generated, idempotent DDL — the prerequisite for anything working,
 * unlike the content/data migrations `graft migrate` gates behind --apply).
 * `--dry-run` lists what is pending without connecting a migrator.
 */
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";

export interface DbMigrateOptions {
  cwd: string;
  dryRun?: boolean;
}

export interface DbMigrateResult {
  applied: string[];
  pending: string[];
  dryRun: boolean;
}

export async function dbMigrateCommand(options: DbMigrateOptions): Promise<DbMigrateResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));

  // A static project has no database to migrate. Refusing here (rather than
  // migrating a database the project will never read) keeps the two tiers
  // honest, and the fix names the order: switch the index, then migrate.
  if (config.index.driver === "static") {
    throw new GraftError({
      code: "NEEDS_DATABASE",
      message:
        "This project's content index is static (a SQLite artifact), so there is no database schema to migrate.",
      fix: 'Static projects need no migrations — just `graft compile`. To move to the Postgres tier: set `export const index = "postgres"` in graft.config.ts and DATABASE_URL in .env, then re-run `graft db migrate` followed by `graft compile`.',
      details: { index: config.index.driver },
    });
  }

  const url = requireDatabaseUrl();
  const { runMigrations } = await import("@usegraft/db");
  return runMigrations(url, { dryRun: options.dryRun });
}

export function formatMigrateResult(result: DbMigrateResult): string {
  if (result.dryRun) {
    return result.pending.length === 0
      ? "Schema is up to date — no migrations pending."
      : [
          `${result.pending.length} migration(s) pending:`,
          ...result.pending.map((tag) => `  ${tag}`),
          "",
          "Run `graft db migrate` (without --dry-run) to apply them.",
        ].join("\n");
  }
  if (result.applied.length === 0) {
    return "Schema is up to date — nothing to apply.";
  }
  return [
    `Applied ${result.applied.length} migration(s):`,
    ...result.applied.map((tag) => `  ${tag}`),
    "",
    "Next: `graft compile` to project your content into the index.",
  ].join("\n");
}
