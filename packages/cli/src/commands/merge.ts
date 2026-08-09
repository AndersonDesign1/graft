/**
 * graft merge — fold a branch back into its target, dry-run by default.
 *
 * Content is git-authoritative (top invariant), so merging content is a git
 * merge of the authored files followed by a recompile of the target — this
 * command does NOT touch git. Run it from a working tree that already contains
 * the merged content (and the branch's migrations/ files). What it does do:
 *
 *   1. Replay the migrations ledger: every migration applied on the branch but
 *      not the target. Data migrations run for real against the target's rows
 *      (updates + ledger row in one transaction, before any branch rows move);
 *      content migrations only record a ledger row — their file rewrites are
 *      already in the git tree being compiled.
 *   2. Apply data deltas: move the branch's data_records rows onto the target
 *      (a branch's rows are exactly the rows created on it — data reads are
 *      exact-branch until the tombstone/inheritance decision lands).
 *   3. Recompile: project the working tree into the target's content_index.
 *
 * `--apply` is the operator's consent, same contract as `graft migrate`.
 */
import { basename } from "node:path";
import { GraftError } from "@usegraft/contracts";
import type { ChangeSet, MigrationAppliedRow } from "@usegraft/db";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { discoverMigrations } from "./migrate";

export interface MergeCommandOptions {
  cwd: string;
  /** The branch being merged (the source). */
  branch: string;
  /** The merge target. Defaults to "main". */
  into?: string;
  /** Execute the merge. Defaults to false — report the plan. */
  apply?: boolean;
}

export interface MergeCommandResult {
  /** Ledger ids replayed onto the target (in file order). */
  replayed: string[];
  /** data_records rows moved (dry-run: rows that would move). */
  dataMoved: number;
  /** The recompile's ChangeSet (apply only). */
  compiled?: ChangeSet;
  didApply: boolean;
}

/**
 * The ledger rows the branch has that the target lacks, in migration-id
 * (= file) order — the replay plan. Pure so it is unit-testable.
 */
export function pendingLedgerRows(
  branchRows: MigrationAppliedRow[],
  targetRows: MigrationAppliedRow[],
): MigrationAppliedRow[] {
  const applied = new Set(targetRows.map((row) => row.migrationId));
  return branchRows
    .filter((row) => !applied.has(row.migrationId))
    .sort((a, b) => a.migrationId.localeCompare(b.migrationId));
}

export async function mergeCommand(options: MergeCommandOptions): Promise<MergeCommandResult> {
  const into = options.into ?? "main";

  // Topology guards run before any config/db work.
  if (options.branch === into) {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `Cannot merge "${options.branch}" into itself.`,
      fix: "Pass the preview branch as the argument and the target via --into (default: main).",
      details: { branch: options.branch, into },
    });
  }
  if (options.branch === "main") {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: "main is the root of the topology and cannot be merged into another branch.",
      fix: "Merge preview branches into main (graft merge <branch>), not the other way around.",
      details: { branch: options.branch, into },
    });
  }

  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();

  const [
    { compile, resolveGitSha },
    {
      createDb,
      getBranch,
      listAppliedMigrations,
      recordAppliedMigration,
      countBranchRows,
      moveDataRecords,
      copyDataRecords,
      resolveBranchHandle,
      scopeWriteBranch,
    },
    { runDataMigration },
  ] = await Promise.all([
    import("@usegraft/compiler"),
    import("@usegraft/db"),
    import("@usegraft/core"),
  ]);
  const control = createDb(url);

  // Merging requires both ends registered (no tolerant fallback here — a typo
  // must not silently merge into a fresh overlay id).
  await getBranch(control.db, options.branch).catch(async (e) => {
    await control.close();
    throw e;
  });
  await getBranch(control.db, into).catch(async (e) => {
    await control.close();
    throw e;
  });

  // Each end resolves to its own connection + scope: overlay ends share the
  // control db; a neon end is its own database whose rows live under "main".
  const src = await resolveBranchHandle(control.db, options.branch, { databaseUrl: url });
  const target = await resolveBranchHandle(control.db, into, { databaseUrl: url });
  const srcWrite = scopeWriteBranch(src.scope);
  const targetWrite = scopeWriteBranch(target.scope);
  const sameDb = src.scope.kind === "overlay" && target.scope.kind === "overlay";

  try {
    const [branchLedger, targetLedger] = await Promise.all([
      listAppliedMigrations(src.db, srcWrite),
      listAppliedMigrations(target.db, targetWrite),
    ]);
    const pending = pendingLedgerRows(branchLedger, targetLedger);

    // Every pending ledger id must have its migrations/<id>.ts present — for
    // data migrations to run, and for content migrations as the cheap proxy
    // that the git merge (which carries both the migration file and the
    // rewritten content) actually happened.
    const discovered = await discoverMigrations(config.migrationsDir);
    const byId = new Map(discovered.map((m) => [m.id, m]));
    const missing = pending.filter((row) => !byId.has(row.migrationId));
    if (missing.length > 0) {
      throw new GraftError({
        code: "MIGRATION_FAILED",
        message: `The "${options.branch}" ledger references ${missing.length} migration(s) with no file in ${basename(config.migrationsDir)}/: ${missing.map((row) => row.migrationId).join(", ")}.`,
        fix: "git-merge the branch first — the merged tree must contain the branch's migrations/ files (and its rewritten content) before `graft merge` replays the ledger.",
        details: { missing: missing.map((row) => row.migrationId) },
      });
    }

    const gitSha = resolveGitSha(config.projectDir);
    const replayed: string[] = [];

    // Replay BEFORE moving data rows: the branch's rows were already migrated
    // on the branch, so only the target's pre-existing rows need transforming.
    for (const row of pending) {
      const entry = byId.get(row.migrationId);
      if (!entry) continue; // unreachable — missing ids rejected above
      const { migration } = entry;
      const label = `${row.migrationId} [${row.kind}] ${row.collection}`;

      if (migration.kind === "data") {
        const report = await runDataMigration({
          db: target.db,
          migration,
          migrationId: row.migrationId,
          branchId: targetWrite,
          gitSha,
          apply: options.apply,
        });
        console.log(
          options.apply
            ? `replayed ${label} — ${report.changed} row(s) updated on "${into}", ${report.unchanged} unchanged`
            : `would replay ${label} — ${report.changed} of ${report.rows} row(s) on "${into}"`,
        );
      } else if (options.apply) {
        // Content rewrites arrive via the git merge; the recompile below
        // projects them. Recording the ledger row is what stops the target
        // from re-running the codemod.
        await recordAppliedMigration(target.db, {
          branchId: targetWrite,
          migrationId: row.migrationId,
          kind: "content",
          collection: row.collection,
          docCount: row.docCount,
          gitSha,
        });
        console.log(`recorded ${label} — content arrived via the git merge`);
      } else {
        console.log(`would record ${label} — content arrives via the git merge`);
      }
      replayed.push(row.migrationId);
    }
    if (pending.length === 0) console.log(`Ledger: nothing to replay on "${into}".`);

    // Data deltas. Same database (overlay → overlay): move the rows by
    // rewriting branch_id. Different databases (a neon end): additively copy
    // them — a neon fork started with empty operational data, so everything
    // it holds is branch-created.
    const counts = await countBranchRows(src.db, srcWrite);
    const verb = sameDb ? "move" : "copy";
    let dataMoved = counts.data;
    if (options.apply && counts.data > 0) {
      dataMoved = sameDb
        ? await moveDataRecords(control.db, { from: options.branch, into })
        : await copyDataRecords(src.db, target.db, {
            fromBranch: srcWrite,
            intoBranch: targetWrite,
          });
      console.log(
        `${verb === "move" ? "moved" : "copied"} ${dataMoved} data_records row(s) from "${options.branch}" onto "${into}"`,
      );
    } else {
      console.log(
        counts.data > 0
          ? `would ${verb} ${counts.data} data_records row(s) from "${options.branch}" onto "${into}"`
          : `Data: "${options.branch}" owns no data_records rows.`,
      );
    }

    // Recompile the (git-merged) working tree into the target.
    let compiled: ChangeSet | undefined;
    if (options.apply) {
      const result = await compile({
        db: target.db,
        contentDir: config.contentDir,
        collections: config.collections,
        branchId: targetWrite,
        gitSha,
      });
      compiled = result.changes;
      console.log(
        `recompiled "${into}": +${compiled.added.length} ~${compiled.changed.length} -${compiled.removed.length} (${compiled.unchanged} unchanged)`,
      );
      console.log(
        `\nMerge complete. Drop the branch when you're done with it: graft branch drop ${options.branch}`,
      );
    } else {
      console.log(`would recompile the working tree into "${into}"`);
      console.log(
        `\nDry run — nothing was written. git-merge the branch's commits first if you haven't, then run \`graft merge ${options.branch} --apply\`.`,
      );
    }

    return { replayed, dataMoved, compiled, didApply: options.apply === true };
  } finally {
    await src.close();
    await target.close();
    await control.close();
  }
}
