/**
 * graft content import — load the files into a database-sourced project.
 * The other `graft content` commands run the MCP tools (commands/tools.ts).
 */
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { operatorName } from "./approvals";

export interface ContentCommandOptions {
  cwd: string;
  branchId?: string;
}

export interface ContentImportResult {
  branch: string;
  imported: string[];
  unchanged: string[];
  /** Files whose document is already published with other content, left as it is. */
  kept: string[];
  /** What the index did. */
  compiled?: { added: number; changed: number; removed: number };
  dryRun: boolean;
}

/**
 * graft content import — load the files under contentDir into a project that
 * keeps its content in the database: how a project moves to
 * `content = { source: "database" }`. Every file is validated first, so a
 * bad one stops the import before anything is written. Only documents with
 * nothing published come in: a published document is never overwritten, and
 * a document with no file is left alone, so re-running is safe.
 */
export async function contentImportCommand(
  options: ContentCommandOptions & { dryRun?: boolean },
): Promise<ContentImportResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  if (config.content.source !== "database") {
    throw new GraftError({
      code: "CONTENT_SOURCE_MISMATCH",
      message:
        "This project keeps its content in git, so there is nothing to import the files into.",
      fix: 'Set `content: { source: "database" }` in graft.config.ts, then run graft content import.',
      details: { source: config.content.source },
    });
  }
  const url = requireDatabaseUrl();
  const [
    { compile, gitBlobSha, readSourceFiles, validateDocuments },
    { createDb, importPublished, readHeads },
  ] = await Promise.all([import("@usegraft/compiler"), import("@usegraft/db")]);
  // The bytes validated are the bytes imported: each file is read once.
  const sources = readSourceFiles(config.contentDir);
  const docs = validateDocuments(sources, config.collections, { mdxTrust: config.mdxTrust });
  const valid = new Set(docs.map((doc) => doc.sourcePath));
  const files = sources
    .filter((file) => valid.has(file.sourcePath))
    .map((file) => ({ path: file.sourcePath, raw: file.raw, version: gitBlobSha(file.raw) }));
  const branch = options.branchId ?? "main";
  const handle = createDb(url);
  try {
    if (options.dryRun) {
      const heads = new Map(
        (await readHeads(handle.db, branch, { paths: files.map((file) => file.path) })).map(
          (head) => [head.path, head],
        ),
      );
      const result: ContentImportResult = {
        branch,
        imported: [],
        unchanged: [],
        kept: [],
        dryRun: true,
      };
      for (const file of files) {
        const live = heads.get(file.path)?.published;
        if (!live) result.imported.push(file.path);
        else if (live.version === file.version) result.unchanged.push(file.path);
        else result.kept.push(file.path);
      }
      return result;
    }
    const result = await importPublished(handle.db, {
      branchId: branch,
      files,
      actor: { id: operatorName(), name: operatorName() },
      message: "Imported from files",
    });
    // An import names no base versions, so nothing can be refused as stale.
    if (!result.ok) throw new Error("content import was refused without a base version");
    const { imported, unchanged, kept } = result;
    // Compile even when nothing new came in: the index then matches what is
    // published, whatever state an earlier run left it in.
    const compiled = await compile({
      db: handle.db,
      contentDir: config.contentDir,
      collections: config.collections,
      mdxTrust: config.mdxTrust,
      branchId: branch,
      source: "database",
    });
    return {
      branch,
      imported,
      unchanged,
      kept,
      compiled: {
        added: compiled.changes.added.length,
        changed: compiled.changes.changed.length,
        removed: compiled.changes.removed.length,
      },
      dryRun: false,
    };
  } finally {
    await handle.close();
  }
}

export function formatImport(result: ContentImportResult): string[] {
  const verb = result.dryRun ? "Would import" : "Imported";
  const lines = [
    `${verb} ${result.imported.length} document(s) into the database on branch "${result.branch}" (${result.unchanged.length} already up to date).`,
  ];
  for (const path of result.imported) lines.push(`  ${path}`);
  if (result.kept.length > 0) {
    lines.push(
      `Left ${result.kept.length} already published document(s) as they are; edit them in Studio:`,
    );
    for (const path of result.kept) lines.push(`  ${path}`);
  }
  if (result.compiled) {
    lines.push(
      `Index: +${result.compiled.added} added, ~${result.compiled.changed} changed, -${result.compiled.removed} removed.`,
    );
  }
  return lines;
}
