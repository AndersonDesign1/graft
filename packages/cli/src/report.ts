/**
 * CLI-facing rendering of GraftErrors and compile results.
 *
 * Errors keep the same agent-actionable shape the MCP surface returns: the code,
 * the message, and the `fix` — printed instead of JSON-encoded.
 */
import type { CompileResult } from "@graft/compiler";
import type { GraftError } from "@graft/contracts";

export function printGraftError(error: GraftError): void {
  console.error(`error ${error.code}: ${error.message}`);
  if (error.fix) console.error(`  fix: ${error.fix}`);
  if (error.details) console.error(`  details: ${JSON.stringify(error.details)}`);
}

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
