/**
 * graft doctor — where this project's setup stands, as a checklist with the
 * one next step. MCP `setup_status` answers the same, so a coding agent and
 * the person it is helping read the same thing.
 */
import type { SetupStatus } from "@usegraft/compiler";
import { findConfig, loadConfig, loadProjectEnv } from "../config";

export async function doctorCommand(options: { cwd: string }): Promise<SetupStatus> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const { setupStatus } = await import("@usegraft/compiler");
  const url = process.env.DATABASE_URL;
  const postgres = config.index.driver === "postgres";
  const handle = postgres && url ? (await import("@usegraft/db")).createDb(url) : undefined;
  try {
    return await setupStatus({
      projectDir: config.projectDir,
      contentDir: config.contentDir,
      index: config.index.driver,
      source: config.content.source,
      ...(config.index.driver === "static" ? { staticIndexPath: config.index.path } : {}),
      ...(handle ? { db: handle.db } : {}),
      ...(url ? { databaseUrl: url } : {}),
    });
  } finally {
    await handle?.close();
  }
}
