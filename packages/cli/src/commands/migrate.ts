/**
 * graft migrate — run content + data migrations, dry-run by default.
 *
 * Migrations are code: migrations/<seq>-<name>.ts files default-exporting a
 * defineContentMigration (rewrites MDX files, then compiles — the change lands
 * as a reviewable git commit) or defineDataMigration (transforms data_records
 * rows in one transaction). The filename stem is the migration's identity in
 * the migrations_applied ledger; files run in name order. Dry-run costs
 * nothing and shows exactly what --apply would do — apply is the operator's
 * explicit consent, the CLI-side analogue of `graft approve`.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { GraftError } from "@graft/contracts";
import {
  runContentMigration,
  type AnyContentMigration,
  type ContentMigrationReport,
} from "@graft/content-migrations";
import { runDataMigration, type AnyDataMigration, type DataMigrationReport } from "@graft/core";
import { createJiti } from "jiti";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";

export type AnyMigration = AnyContentMigration | AnyDataMigration;

export interface DiscoveredMigration {
  /** Ledger identity: the file name stem (renaming a file makes a new migration). */
  id: string;
  file: string;
  migration: AnyMigration;
}

export interface MigrateCommandOptions {
  cwd: string;
  branchId?: string;
  /** Run the pending migrations. Defaults to false — report what would happen. */
  apply?: boolean;
}

export interface MigrationOutcome {
  id: string;
  kind: "content" | "data";
  collection: string;
  description: string;
  report: ContentMigrationReport | DataMigrationReport;
}

export interface MigrateCommandResult {
  applied: string[];
  pending: MigrationOutcome[];
  /** True when `pending` was executed rather than dry-run. */
  didApply: boolean;
}

/** Load every migrations/<name>.ts in name order via jiti (user-owned TS, no build). */
export async function discoverMigrations(migrationsDir: string): Promise<DiscoveredMigration[]> {
  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) return [];

  const files = readdirSync(migrationsDir)
    .filter((name) => /\.(ts|mts|js|mjs)$/.test(name))
    .sort()
    .map((name) => join(migrationsDir, name));

  const jiti = createJiti(migrationsDir, { moduleCache: false });
  const discovered: DiscoveredMigration[] = [];
  for (const file of files) {
    const id = basename(file).replace(/\.(ts|mts|js|mjs)$/, "");
    let mod: Record<string, unknown>;
    try {
      mod = (await jiti.import(file)) as Record<string, unknown>;
    } catch (error) {
      throw new GraftError({
        code: "MIGRATION_FAILED",
        message: `Migration file ${basename(file)} failed to load: ${error instanceof Error ? error.message : String(error)}`,
        fix: "Fix the error in the file — it must be importable and default-export defineContentMigration(…) or defineDataMigration(…).",
        details: { file },
      });
    }
    const migration = mod.default as AnyMigration | undefined;
    if (
      !migration ||
      (migration.kind !== "content" && migration.kind !== "data") ||
      typeof migration.transform !== "function"
    ) {
      throw new GraftError({
        code: "MIGRATION_FAILED",
        message: `${basename(file)} does not default-export a migration.`,
        fix: `Add \`export default defineContentMigration({ … })\` (from "@graft/content-migrations") or \`export default defineDataMigration({ … })\` (from "@graft/core").`,
        details: { file, exports: Object.keys(mod) },
      });
    }
    discovered.push({ id, file, migration });
  }
  return discovered;
}

export async function migrateCommand(
  options: MigrateCommandOptions,
): Promise<MigrateCommandResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const branchId = options.branchId ?? "main";

  const migrations = await discoverMigrations(config.migrationsDir);
  if (migrations.length === 0) {
    console.log(
      `No migrations found in ${config.migrationsDir}.\n` +
        `Author one as migrations/0001-<name>.ts default-exporting defineContentMigration or defineDataMigration.`,
    );
    return { applied: [], pending: [], didApply: false };
  }

  const url = requireDatabaseUrl();
  const [{ compile, resolveGitSha }, { createDb, listAppliedMigrations, recordAppliedMigration }] =
    await Promise.all([import("@graft/compiler"), import("@graft/db")]);
  const handle = createDb(url);

  try {
    const appliedRows = await listAppliedMigrations(handle.db, branchId);
    const appliedIds = new Set(appliedRows.map((row) => row.migrationId));
    const applied = migrations.filter((m) => appliedIds.has(m.id)).map((m) => m.id);
    const pending = migrations.filter((m) => !appliedIds.has(m.id));

    if (applied.length > 0) {
      console.log(`Already applied on "${branchId}": ${applied.join(", ")}`);
    }
    if (pending.length === 0) {
      console.log("Nothing pending — the branch is up to date.");
      return { applied, pending: [], didApply: false };
    }

    const gitSha = resolveGitSha(config.projectDir);
    const outcomes: MigrationOutcome[] = [];

    for (const { id, migration } of pending) {
      const label = `${id} [${migration.kind}] ${migration.collection.name} — ${migration.description}`;

      if (migration.kind === "content") {
        const report = await runContentMigration({
          contentDir: config.contentDir,
          migration,
          apply: options.apply,
        });
        if (options.apply) {
          // Compile before the ledger row: an applied content migration is only
          // real once the rewritten files validate and project cleanly.
          const compiled = await compile({
            db: handle.db,
            contentDir: config.contentDir,
            collections: config.collections,
            branchId,
            gitSha,
          });
          await recordAppliedMigration(handle.db, {
            branchId,
            migrationId: id,
            kind: "content",
            collection: migration.collection.name,
            docCount: report.changed,
            gitSha,
          });
          console.log(
            `applied ${label}\n  ${report.changed} file(s) rewritten, ${report.unchanged} unchanged; compiled: +${compiled.changes.added.length} ~${compiled.changes.changed.length} -${compiled.changes.removed.length}`,
          );
        } else {
          console.log(
            `pending ${label}\n  would rewrite ${report.changed} file(s) (${report.unchanged} unchanged)`,
          );
        }
        outcomes.push({
          id,
          kind: "content",
          collection: migration.collection.name,
          description: migration.description,
          report,
        });
      } else {
        const report = await runDataMigration({
          db: handle.db,
          migration,
          migrationId: id,
          branchId,
          gitSha,
          apply: options.apply,
        });
        console.log(
          options.apply
            ? `applied ${label}\n  ${report.changed} row(s) updated, ${report.unchanged} unchanged`
            : `pending ${label}\n  would update ${report.changed} of ${report.rows} row(s)`,
        );
        outcomes.push({
          id,
          kind: "data",
          collection: migration.collection.name,
          description: migration.description,
          report,
        });
      }
    }

    if (!options.apply) {
      console.log(`\nDry run — nothing was written. Run \`graft migrate --apply\` to execute.`);
    } else {
      console.log(
        `\n${outcomes.length} migration(s) applied. Commit the changes — git is the version history.`,
      );
    }
    return { applied, pending: outcomes, didApply: options.apply === true };
  } finally {
    await handle.close();
  }
}
