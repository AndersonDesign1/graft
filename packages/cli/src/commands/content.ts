/**
 * graft content — list the content tree from the compiled index.
 * Same data as GET /api/studio/v1/tree (MCP: list_collections + list_content).
 * `graft content import` loads the files into a database-sourced project.
 */
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { operatorName } from "./approvals";

export interface ContentCommandOptions {
  cwd: string;
  branchId?: string;
}

export interface ContentTreeLine {
  collection: string;
  slug: string;
  sourcePath: string;
  title?: string;
}

export async function contentListCommand(
  options: ContentCommandOptions,
): Promise<{ branch: string; lines: ContentTreeLine[] }> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();
  const { createDb, readContent, resolveBranchScope } = await import("@usegraft/db");
  const handle = createDb(url);
  const branch = options.branchId ?? "main";
  try {
    const scope = await resolveBranchScope(handle.db, branch);
    const lines: ContentTreeLine[] = [];
    for (const name of Object.keys(config.collections).sort()) {
      const rows = await readContent(handle.db, scope, { collection: name });
      for (const row of rows) {
        const title =
          typeof row.data.title === "string"
            ? row.data.title
            : typeof row.data.name === "string"
              ? row.data.name
              : undefined;
        lines.push({
          collection: name,
          slug: row.slug,
          sourcePath: row.sourcePath,
          ...(title ? { title } : {}),
        });
      }
    }
    return { branch, lines };
  } finally {
    await handle.close();
  }
}

export function formatContentLine(line: ContentTreeLine): string {
  const label = line.title ? `${line.slug}  (${line.title})` : line.slug;
  return `${line.collection}/${label}  ${line.sourcePath}`;
}

export interface ContentImportResult {
  branch: string;
  imported: string[];
  unchanged: string[];
  /** What the index did, when anything was imported. */
  compiled?: { added: number; changed: number; removed: number };
  dryRun: boolean;
}

/**
 * graft content import — make the files under contentDir the live revisions
 * in Postgres. How a project moves to `content = { source: "database" }`.
 * Every file is validated first, so a bad one stops the import before
 * anything is written. Additive and idempotent: re-running imports only the
 * files that changed, and documents with no file are left alone.
 */
export async function contentImportCommand(
  options: ContentCommandOptions & { dryRun?: boolean },
): Promise<ContentImportResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();
  const [{ compile, gitBlobSha, readDocs }, { createDb, importPublished, publishedFiles }] =
    await Promise.all([import("@usegraft/compiler"), import("@usegraft/db")]);
  const docs = readDocs(config.contentDir, config.collections, { mdxTrust: config.mdxTrust });
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const files = docs.map((doc) => {
    const raw = readFileSync(join(config.contentDir, doc.sourcePath), "utf8");
    return { path: doc.sourcePath, raw, version: gitBlobSha(raw) };
  });
  const branch = options.branchId ?? "main";
  const handle = createDb(url);
  try {
    if (options.dryRun) {
      const live = new Map(
        (await publishedFiles(handle.db, branch)).map((file) => [file.path, file.version]),
      );
      const unchanged = files.filter((file) => live.get(file.path) === file.version);
      return {
        branch,
        imported: files.filter((file) => !unchanged.includes(file)).map((file) => file.path),
        unchanged: unchanged.map((file) => file.path),
        dryRun: true,
      };
    }
    const result = await importPublished(handle.db, {
      branchId: branch,
      files,
      actor: { id: operatorName(), name: operatorName() },
      message: "Imported from files",
    });
    if (result.imported.length === 0) return { branch, ...result, dryRun: false };
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
      ...result,
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
  if (result.compiled) {
    lines.push(
      `Index: +${result.compiled.added} added, ~${result.compiled.changed} changed, -${result.compiled.removed} removed.`,
    );
  }
  return lines;
}
