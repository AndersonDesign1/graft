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
import { GraftError } from "@usegraft/contracts";
import { type AddPlan, applyPlan, listItemNames, planAdd } from "@usegraft/registry";
import { findConfig } from "../config";

export interface AddCommandOptions {
  cwd: string;
  names: string[];
  dryRun?: boolean;
  overwrite?: boolean;
}

export async function addCommand(options: AddCommandOptions): Promise<void> {
  if (options.names.length === 0) {
    throw new GraftError({
      code: "REGISTRY_ITEM_NOT_FOUND",
      message: "graft add needs an item name.",
      fix: `Usage: graft add <item>. Available items: ${listItemNames().join(", ") || "(none bundled)"}.`,
    });
  }

  const projectDir = dirname(findConfig(options.cwd));
  const plan = planAdd(options.names, { targetDir: projectDir });

  console.log(
    `${options.dryRun ? "Would add" : "Adding"} ${plan.items.map((i) => `${i.name} (${i.type})`).join(", ")}:`,
  );
  for (const file of plan.files) {
    const state = file.identical ? "unchanged" : file.exists ? "overwrite" : "create";
    console.log(`  ${state.padEnd(9)} ${file.relPath}`);
  }
  console.log(`  regenerate ${plan.barrel.relPath}`);
  if (plan.mdxMap) console.log(`  regenerate ${plan.mdxMap.relPath}`);

  if (options.dryRun) {
    if (plan.conflicts.length > 0) {
      console.log(
        `\n${plan.conflicts.length} existing file(s) differ — re-run without --dry-run and with --overwrite to replace: ${plan.conflicts.join(", ")}`,
      );
    }
    printFollowups(plan);
    return;
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
}

function printFollowups(plan: AddPlan): void {
  const deps = Object.entries(plan.npmDependencies);
  if (deps.length > 0) {
    console.log("\nEnsure these packages are installed:");
    for (const [pkg, spec] of deps) console.log(`  ${pkg}@${spec}`);
  }
}
