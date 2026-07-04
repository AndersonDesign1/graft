/**
 * graft dev — watch the content tree + graft.config and recompile on change.
 *
 * Failures never stop the watcher: a validation error prints its `fix` and the
 * next save retries — the edit → compile → render loop an agent or human sits in.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, relative } from "node:path";
import { GraftError } from "@graft/contracts";
import {
  CONFIG_FILENAMES,
  findConfig,
  loadConfig,
  loadProjectEnv,
  requireDatabaseUrl,
  type ProjectConfig,
} from "../config";
import { formatCompileResult, printGraftError } from "../report";

const DEBOUNCE_MS = 150;

export interface DevCommandOptions {
  cwd: string;
  branchId?: string;
}

/** Resolves when the watcher is stopped (SIGINT/SIGTERM). */
export async function devCommand(options: DevCommandOptions): Promise<void> {
  loadProjectEnv(options.cwd);
  const configPath = findConfig(options.cwd);
  let config: ProjectConfig = await loadConfig(configPath);

  if (!existsSync(config.contentDir)) {
    throw new GraftError({
      code: "CONTENT_DIR_NOT_FOUND",
      message: `Content directory ${config.contentDir} does not exist.`,
      fix: "Create it (documents live at <contentDir>/<collection>/<slug>.mdx) or fix the `contentDir` export in graft.config.ts, then restart `graft dev`.",
    });
  }

  const url = requireDatabaseUrl();
  // Heavy imports (compiler → database driver) only after the project checks out.
  const [{ compile }, { createDb }] = await Promise.all([
    import("@graft/compiler"),
    import("@graft/db"),
  ]);
  const handle = createDb(url);
  let timer: NodeJS.Timeout | undefined;
  let compiling = false;
  let dirty = false;
  let configDirty = false;

  const runCompile = async (): Promise<void> => {
    if (compiling) {
      dirty = true;
      return;
    }
    compiling = true;
    try {
      if (configDirty) {
        configDirty = false;
        config = await loadConfig(configPath);
        console.log(`reloaded ${basename(configPath)}`);
      }
      const result = await compile({
        db: handle.db,
        contentDir: config.contentDir,
        collections: config.collections,
        branchId: options.branchId,
      });
      console.log(formatCompileResult(result));
    } catch (error) {
      // Keep watching: the next save is the retry.
      if (error instanceof GraftError) printGraftError(error);
      else console.error(error);
    } finally {
      compiling = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  };

  const schedule = (configChanged = false): void => {
    if (configChanged) configDirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void runCompile(), DEBOUNCE_MS);
  };

  await runCompile();

  const watchers: FSWatcher[] = [
    watch(config.contentDir, { recursive: true }, () => schedule()),
    watch(config.projectDir, (_event, filename) => {
      if (filename && (CONFIG_FILENAMES as readonly string[]).includes(filename)) schedule(true);
    }),
  ];

  const watchedContent = relative(options.cwd, config.contentDir) || ".";
  console.log(
    `Watching ${watchedContent} + ${basename(configPath)} (branch: ${options.branchId ?? "main"}). Ctrl+C to stop.`,
  );

  await new Promise<void>((resolveStopped) => {
    const stop = (): void => {
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      resolveStopped();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  await handle.close();
}
