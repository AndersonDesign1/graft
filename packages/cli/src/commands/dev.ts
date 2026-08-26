/**
 * graft dev — watch the content tree + graft.config and recompile on change.
 *
 * Failures never stop the watcher: a validation error prints its `fix` and the
 * next save retries — the edit → compile → render loop an agent or human sits in.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, relative } from "node:path";
import { GraftError } from "@usegraft/contracts";
import {
  CONFIG_FILENAMES,
  findConfig,
  loadConfig,
  loadProjectEnv,
  requireDatabaseUrl,
  type ProjectConfig,
} from "../config";
import { formatCompileResult, printGraftError } from "../report";
import { assertNoStaticBranch } from "./compile";

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

  // Static mode: no env, no connections — the compile target is the artifact.
  const isStatic = config.index.driver === "static";
  if (isStatic) assertNoStaticBranch(options.branchId);

  const url = isStatic ? undefined : requireDatabaseUrl();
  // Heavy imports (compiler → database driver) only after the project checks out.
  const [compiler, { createDb, resolveBranchHandle, scopeWriteBranch }] = await Promise.all([
    import("@usegraft/compiler"),
    import("@usegraft/db"),
  ]);
  const { compile, compileStatic } = compiler;
  // Resolved once at startup: a neon branch gets its own connection; overlay
  // (registered or not) shares the control one. Static mode opens nothing.
  const control = url !== undefined ? createDb(url) : undefined;
  const branch =
    control !== undefined && url !== undefined
      ? await resolveBranchHandle(control.db, options.branchId ?? "main", { databaseUrl: url })
      : undefined;
  const writeBranch = branch !== undefined ? scopeWriteBranch(branch.scope) : "main";
  let timer: NodeJS.Timeout | undefined;
  /** Set once the watchers exist; recompiles are scheduled before that. */
  let rewatchContent: ((dir: string) => void) | undefined;
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
        const previousContentDir = config.contentDir;
        config = await loadConfig(configPath);
        console.log(`reloaded ${basename(configPath)}`);
        // Watchers were created once at startup against the ORIGINAL
        // contentDir, so a config edit that relocated it left compile reading
        // one directory while the watcher polled another: every later save was
        // invisible and `graft dev` silently stopped recompiling.
        if (config.contentDir !== previousContentDir) rewatchContent?.(config.contentDir);
      }
      const result =
        branch !== undefined
          ? await compile({
              db: branch.db,
              contentDir: config.contentDir,
              collections: config.collections,
              branchId: writeBranch,
            })
          : await compileStatic({
              contentDir: config.contentDir,
              collections: config.collections,
              indexPath: (config.index as { driver: "static"; path: string }).path,
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

  let contentWatcher = watch(config.contentDir, { recursive: true }, () => schedule());
  const watchers: FSWatcher[] = [
    watch(config.projectDir, (_event, filename) => {
      if (filename && (CONFIG_FILENAMES as readonly string[]).includes(filename)) schedule(true);
    }),
  ];

  rewatchContent = (dir: string): void => {
    contentWatcher.close();
    contentWatcher = watch(dir, { recursive: true }, () => schedule());
    console.log(`now watching ${relative(options.cwd, dir) || "."}`);
  };

  const watchedContent = relative(options.cwd, config.contentDir) || ".";
  const branchLabel =
    branch === undefined
      ? "static index"
      : branch.scope.kind === "physical"
        ? `${branch.name} (neon)`
        : (options.branchId ?? "main");
  console.log(
    `Watching ${watchedContent} + ${basename(configPath)} (branch: ${branchLabel}). Ctrl+C to stop.`,
  );

  await new Promise<void>((resolveStopped) => {
    const stop = (): void => {
      clearTimeout(timer);
      contentWatcher.close();
      for (const watcher of watchers) watcher.close();
      resolveStopped();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  await branch?.close();
  await control?.close();
}
