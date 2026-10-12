/**
 * graft check — every check a publish or compile makes, on the files alone,
 * with no database: the schema, slug uniqueness, MDX safety, and references
 * that point at nothing. What a content-only CI job runs in seconds.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig } from "../config";

export interface CheckResult {
  documents: number;
  problems: string[];
}

export async function checkCommand(options: { cwd: string }): Promise<CheckResult> {
  const config = await loadConfig(findConfig(options.cwd));
  if (!existsSync(config.contentDir)) {
    // A database-sourced checkout that was never pulled has nothing to check.
    return { documents: 0, problems: [] };
  }
  const { findBrokenReferences, readDocs } = await import("@usegraft/compiler");
  let docs;
  try {
    docs = readDocs(config.contentDir, config.collections, { mdxTrust: config.mdxTrust });
  } catch (error) {
    if (!(error instanceof GraftError)) throw error;
    // readDocs stops at the first kind of problem; report it like the rest.
    return { documents: 0, problems: [`${error.code}: ${error.message}\n  ${error.fix ?? ""}`] };
  }
  const where = relative(options.cwd, config.contentDir) || ".";
  const problems = findBrokenReferences(docs, config.collections).map(
    (ref) =>
      `CONTENT_REFERENCE_NOT_FOUND: ${where}/${ref.sourcePath} field "${ref.field}" points at ${ref.to}/${ref.slug}, which doesn't exist.\n  Create ${ref.to}/${ref.slug}, or change the field to a document that exists.`,
  );
  return { documents: docs.length, problems };
}
