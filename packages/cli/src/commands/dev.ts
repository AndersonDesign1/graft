/**
 * graft dev — watch the content tree + graft.config and recompile on change.
 *
 * Failures never stop the watcher: a validation error prints its `fix` and the
 * next save retries — the edit → compile → render loop an agent or human sits in.
 *
 * `graft dev -- next dev` also runs the site's own dev server, after the first
 * compile so the index exists when it starts. One terminal, one Ctrl+C: when
 * either stops, both do.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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
import { reportError } from "../output";
import { formatCompileResult } from "../report";
import { assertNoStaticBranch } from "./compile";

const DEBOUNCE_MS = 150;

export interface DevCommandOptions {
  cwd: string;
  branchId?: string;
  /** A dev server to run alongside, such as ["next", "dev"]: what follows `--`. */
  command?: readonly string[];
}

/**
 * Resolves when the watcher is stopped (SIGINT/SIGTERM), or when the command
 * it runs exits, with the exit code `graft dev` should end with.
 */
export async function devCommand(options: DevCommandOptions): Promise<number> {
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
  let rewatchContent: (() => void) | undefined;
  let compiling = false;
  let dirty = false;
  let configDirty = false;
  /** Whether a compile has succeeded: the dev server waits for one, so it never starts without an index. */
  let compiled = false;
  /** Starts the dev server once a compile has succeeded; set once the stop logic below exists. */
  let startServerIfReady: (() => void) | undefined;

  const runCompile = async (): Promise<void> => {
    if (compiling) {
      dirty = true;
      return;
    }
    compiling = true;
    try {
      if (configDirty) {
        configDirty = false;
        const previous = config;
        config = await loadConfig(configPath);
        console.log(`reloaded ${basename(configPath)}`);
        // Watchers were created once at startup against the ORIGINAL
        // contentDir, so a config edit that relocated it left compile reading
        // one directory while the watcher polled another: every later save was
        // invisible and `graft dev` silently stopped recompiling.
        // Switching the content source starts or stops the file watcher the
        // same way.
        if (
          config.contentDir !== previous.contentDir ||
          config.content.source !== previous.content.source
        ) {
          rewatchContent?.();
        }
      }
      const result =
        branch !== undefined
          ? await compile({
              db: branch.db,
              contentDir: config.contentDir,
              collections: config.collections,
              mdxTrust: config.mdxTrust,
              branchId: writeBranch,
              source: config.content.source,
            })
          : await compileStatic({
              contentDir: config.contentDir,
              collections: config.collections,
              mdxTrust: config.mdxTrust,
              indexPath: (config.index as { driver: "static"; path: string }).path,
            });
      console.log(formatCompileResult(result));
      compiled = true;
      startServerIfReady?.();
    } catch (error) {
      // Keep watching: the next save is the retry.
      if (error instanceof GraftError) reportError(error, false);
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

  // In a database-sourced project the files are a checkout: an edit to one
  // changes nothing until it is pushed, so watching them would only mislead.
  const watchContent = (): FSWatcher | undefined =>
    config.content.source === "database"
      ? undefined
      : watch(config.contentDir, { recursive: true }, () => schedule());
  const fromDatabase = config.content.source === "database";
  let contentWatcher = watchContent();
  const watchers: FSWatcher[] = [
    watch(config.projectDir, (_event, filename) => {
      if (filename && (CONFIG_FILENAMES as readonly string[]).includes(filename)) schedule(true);
    }),
  ];

  rewatchContent = (): void => {
    contentWatcher?.close();
    contentWatcher = watchContent();
    console.log(
      contentWatcher
        ? `now watching ${relative(options.cwd, config.contentDir) || "."}`
        : "content is in the database: edit it in Studio",
    );
  };

  const watchedContent = relative(options.cwd, config.contentDir) || ".";
  const branchLabel =
    branch === undefined
      ? "static index"
      : branch.scope.kind === "physical"
        ? `${branch.name} (neon)`
        : (options.branchId ?? "main");
  // Publishes already update the index; what a developer needs to hear is
  // that their files are now behind. Polled, not LISTENed: a pooled
  // connection (most hosted Postgres) drops LISTEN between transactions.
  let announcer: NodeJS.Timeout | undefined;
  if (fromDatabase && branch !== undefined) {
    const { publishedSince } = await import("@usegraft/db");
    let since = new Date();
    let seen = new Set<string>();
    announcer = setInterval(() => {
      void publishedSince(branch.db, writeBranch, since)
        .then((changes) => {
          const fresh = changes.filter((change) => !seen.has(change.id));
          const last = changes.at(-1);
          if (last) {
            since = last.publishedAt;
            // Only revisions at the newest timestamp can come back next time.
            seen = new Set(
              changes.filter((c) => c.publishedAt.getTime() === since.getTime()).map((c) => c.id),
            );
          }
          for (const line of announce(fresh)) console.log(line);
        })
        .catch(() => {
          // A dropped connection is retried on the next tick.
        });
    }, ANNOUNCE_MS);
  }
  console.log(
    fromDatabase
      ? `Content is in the database (branch: ${branchLabel}): edit it in Studio. Watching ${basename(configPath)}. Ctrl+C to stop.`
      : `Watching ${watchedContent} + ${basename(configPath)} (branch: ${branchLabel}). Ctrl+C to stop.`,
  );

  const command = options.command?.length ? options.command : undefined;
  if (command && !compiled) {
    console.log(
      `Fix the error above and save: ${command.join(" ")} starts after the first compile that succeeds.`,
    );
  }
  let server: ChildProcess | undefined;
  const exitCode = await new Promise<number>((resolveStopped) => {
    const stop = (code: number): void => {
      clearTimeout(timer);
      clearInterval(announcer);
      contentWatcher?.close();
      for (const watcher of watchers) watcher.close();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolveStopped(code);
    };
    /** Set when graft dev itself was asked to stop: the server's exit is then expected. */
    let stopping = false;
    const onSignal = (signal: NodeJS.Signals): void => {
      // First, so a compile still running cannot start the server after this.
      stopping = true;
      if (!server || server.exitCode !== null || server.signalCode !== null) return stop(0);
      // The terminal sends Ctrl+C to the server too; a SIGTERM may reach only
      // graft dev. Either way, stop once the server has.
      stopServer(server, signal);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    startServerIfReady = (): void => {
      if (!command || !compiled || server || stopping) return;
      const started = startServer(command, options.cwd);
      server = started;
      started.once("exit", (code, signal) => {
        if (stopping) return stop(0);
        const how = signal === null ? `exited with ${code ?? 0}` : `was stopped by ${signal}`;
        console.log(`${command.join(" ")} ${how}; stopping graft dev.`);
        stop(code ?? 1);
      });
      started.once("error", (error) => {
        reportError(
          new GraftError({
            code: "USAGE_INVALID",
            message: `graft dev could not start \`${command.join(" ")}\`: ${error.message}.`,
            fix: "Check the command after `--` is installed (run it on its own to see), or drop `--` and what follows to only recompile.",
            details: { command },
          }),
          false,
        );
        stop(127);
      });
    };
    startServerIfReady();
  });

  await branch?.close();
  await control?.close();
  return exitCode;
}

/**
 * Start the site's dev server with this terminal. Through a shell on Windows
 * only, where `next` is `next.cmd`; elsewhere the arguments pass through as
 * typed, spaces included.
 */
function startServer(command: readonly string[], cwd: string): ChildProcess {
  const [file = "", ...args] = command;
  console.log(`Starting ${command.join(" ")}`);
  return spawn(file, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

/**
 * Stop the dev server. On Windows it runs through a shell, and a signal to
 * the shell leaves the server it started running, so the whole tree goes.
 */
function stopServer(server: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32" && server.pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  server.kill(signal);
}

/** How often `graft dev` asks whether anything was published in a database-sourced project. */
const ANNOUNCE_MS = 5_000;

/** One line per publisher: who published what, and the command that brings it into the files. */
export function announce(
  changes: ReadonlyArray<{ path: string; version: string | null; publishedBy: string | null }>,
): string[] {
  if (changes.length === 0) return [];
  const byWho = new Map<string, Set<string>>();
  for (const change of changes) {
    const who = change.publishedBy ?? "Someone";
    const doc = change.path.replace(/\.mdx?$/, "");
    byWho.set(
      who,
      (byWho.get(who) ?? new Set()).add(change.version === null ? `${doc} (deleted)` : doc),
    );
  }
  const lines = [...byWho].map(([who, docs]) => `${who} published ${[...docs].join(", ")}.`);
  lines.push("Run graft pull to bring it into your files.");
  return lines;
}
