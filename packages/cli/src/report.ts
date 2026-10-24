/**
 * CLI-facing rendering of compile results. Errors are printed by output.ts.
 */
import type { CompileResult } from "@usegraft/compiler";
import type { ChangeSet } from "@usegraft/contracts";

export function formatCompileResult(result: CompileResult): string {
  const { added, changed, removed, unchanged } = result.changes;
  const lines = [
    `Compiled ${result.count} doc(s) @ ${result.gitSha?.slice(0, 7) ?? "no-git"}: ` +
      `+${added.length} added, ~${changed.length} changed, -${removed.length} removed, ${unchanged} unchanged`,
  ];
  for (const key of [...added, ...changed]) lines.push(`  upserted ${key}`);
  for (const key of removed) lines.push(`  removed  ${key}`);
  return lines.join("\n");
}

/** What `graft compile --json` prints: the payload a revalidate route reads. */
export interface CompileJson {
  branch: string;
  gitSha: string | null;
  changes: ChangeSet;
}

export function compileJson(branch: string, result: CompileResult): CompileJson {
  const { added, changed, removed, unchanged } = result.changes;
  return { branch, gitSha: result.gitSha, changes: { added, changed, removed, unchanged } };
}
