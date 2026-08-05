/**
 * graft content — list the content tree from the compiled index.
 * Same data as GET /api/studio/v1/tree (MCP: list_collections + list_content).
 */
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";

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
  const { createDb, readContent, resolveBranchScope } = await import("@graft/db");
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
