/**
 * graft add — copy an owned primitive (and its registry dependencies) from the
 * bundled registry into the project, then regenerate the `graft/` barrel that
 * wires it in. Pure file-drop: nothing edits graft.config.ts — the barrel the
 * loader/app already import picks up the new module on the next compile.
 *
 * --dry-run previews without writing; --overwrite replaces files that differ
 * (identical files are always skipped, so re-adding is a no-op).
 */
import { dirname } from "node:path";
import { type AddPlan, applyPlan, planAdd } from "@usegraft/registry";
import { findConfig } from "../config";

export interface AddCommandOptions {
  cwd: string;
  names: string[];
  dryRun?: boolean;
  overwrite?: boolean;
}

/** What `graft add` did, or with --dry-run would do. */
export interface AddResult {
  items: { name: string; type: string }[];
  files: { path: string; state: "create" | "overwrite" | "unchanged" }[];
  /** Files written; empty on a dry run. */
  written: string[];
  /** Existing files that differ from the registry's; replaced only with --overwrite. */
  conflicts: string[];
  /** npm packages the added items import. */
  npmDependencies: Record<string, string>;
  dryRun: boolean;
}

export async function addCommand(options: AddCommandOptions): Promise<AddResult> {
  const projectDir = dirname(findConfig(options.cwd));
  const plan = planAdd(options.names, { targetDir: projectDir });
  const summary: AddResult = {
    items: plan.items.map((item) => ({ name: item.name, type: item.type })),
    files: plan.files.map((file) => ({
      path: file.relPath,
      state: file.identical ? "unchanged" : file.exists ? "overwrite" : "create",
    })),
    written: [],
    conflicts: plan.conflicts,
    npmDependencies: plan.npmDependencies,
    dryRun: Boolean(options.dryRun),
  };

  console.log(
    `${options.dryRun ? "Would add" : "Adding"} ${plan.items.map((i) => `${i.name} (${i.type})`).join(", ")}:`,
  );
  for (const file of summary.files) console.log(`  ${file.state.padEnd(9)} ${file.path}`);
  console.log(`  regenerate ${plan.barrel.relPath}`);
  if (plan.mdxMap) console.log(`  regenerate ${plan.mdxMap.relPath}`);

  if (options.dryRun) {
    if (plan.conflicts.length > 0) {
      console.log(
        `\n${plan.conflicts.length} existing file(s) differ — re-run without --dry-run and with --overwrite to replace: ${plan.conflicts.join(", ")}`,
      );
    }
    printFollowups(plan);
    return summary;
  }

  const result = applyPlan(plan, { overwrite: options.overwrite });
  const parts = [`${result.written.length} written`];
  if (result.skipped.length > 0) parts.push(`${result.skipped.length} unchanged`);
  const regen = [plan.barrel.relPath, result.mdxMapPath].filter(Boolean).join(" + ");
  console.log(
    `\nAdded ${plan.items.map((i) => i.name).join(", ")} (${parts.join(", ")}); ${regen} regenerated.`,
  );
  printFollowups(plan);
  console.log(
    "It's live on your next `graft compile` — no graft.config.ts edit needed (the graft/ barrel wires modules; the MDX map wires blocks).",
  );
  return { ...summary, written: result.written };
}

function printFollowups(plan: AddPlan): void {
  const deps = Object.entries(plan.npmDependencies);
  if (deps.length > 0) {
    console.log("\nEnsure these packages are installed:");
    for (const [pkg, spec] of deps) console.log(`  ${pkg}@${spec}`);
  }
}
