/**
 * graft check — every check a publish or compile makes, on the files alone,
 * with no database: the schema, slug uniqueness, MDX safety, and references
 * that point at nothing. What a content-only CI job runs in seconds.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig } from "../config";

/** One problem with one file, shaped like the GraftError a compile would throw. */
export interface CheckProblem {
  code: string;
  message: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export interface CheckResult {
  documents: number;
  problems: CheckProblem[];
}

export function formatProblem(problem: CheckProblem): string {
  return problem.fix
    ? `${problem.code}: ${problem.message}\n  ${problem.fix}`
    : `${problem.code}: ${problem.message}`;
}

export async function checkCommand(options: { cwd: string }): Promise<CheckResult> {
  const config = await loadConfig(findConfig(options.cwd));
  if (!existsSync(config.contentDir)) {
    // A database-sourced checkout that was never pulled has nothing to check.
    return { documents: 0, problems: [] };
  }
  const { findBrokenReferences, readSourceFiles, validateDocuments } =
    await import("@usegraft/compiler");
  let docs;
  try {
    // References are left to findBrokenReferences below, which lists every one.
    docs = validateDocuments(readSourceFiles(config.contentDir), config.collections, {
      mdxTrust: config.mdxTrust,
    });
  } catch (error) {
    if (!(error instanceof GraftError)) throw error;
    // readDocs stops at the first kind of problem; report it like the rest.
    const problem: CheckProblem = { code: error.code, message: error.message };
    if (error.fix) problem.fix = error.fix;
    if (error.details) problem.details = error.details;
    return { documents: 0, problems: [problem] };
  }
  const where = relative(options.cwd, config.contentDir) || ".";
  const problems = findBrokenReferences(docs, config.collections).map(
    (ref): CheckProblem => ({
      code: "CONTENT_REFERENCE_NOT_FOUND",
      message: `${where}/${ref.sourcePath} field "${ref.field}" points at ${ref.to}/${ref.slug}, which doesn't exist.`,
      fix: `Create ${ref.to}/${ref.slug}, or change the field to a document that exists.`,
      details: { sourcePath: ref.sourcePath, field: ref.field, collection: ref.to, slug: ref.slug },
    }),
  );
  return { documents: docs.length, problems };
}
