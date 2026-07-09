/**
 * Project discovery: find and load a user's graft.config, and resolve the env.
 *
 * The config is user-owned TypeScript loaded at runtime (jiti), so the CLI works
 * against the same file agents and humans edit — no build step, no codegen. The
 * config contract: export `collections` (a record of defineCollection results)
 * and optionally `contentDir` (relative to the config file; defaults to "content").
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GraftError } from "@graft/contracts";
import type { AnyCollection, AnyGraftFunction } from "@graft/core";
import { createJiti } from "jiti";

export const CONFIG_FILENAMES = [
  "graft.config.ts",
  "graft.config.mts",
  "graft.config.js",
  "graft.config.mjs",
] as const;

export interface ProjectConfig {
  configPath: string;
  /** The project root — the directory holding graft.config. */
  projectDir: string;
  /** Absolute path to the content root. */
  contentDir: string;
  /** Absolute path to the migrations directory (may not exist yet). */
  migrationsDir: string;
  collections: Record<string, AnyCollection>;
  /**
   * Typed functions exported from graft.config (optional). Used by `graft mcp`
   * for list_functions / run_function. Empty when the project has none.
   */
  functions: Record<string, AnyGraftFunction>;
}

/** Walk up from `cwd` to the first directory containing a graft.config. */
export function findConfig(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new GraftError({
    code: "CONFIG_NOT_FOUND",
    message: `No graft.config.{ts,js} found in ${resolve(cwd)} or any parent directory.`,
    fix: "cd into a Graft project, or scaffold one here with `graft init`.",
  });
}

function isCollection(value: unknown): value is AnyCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AnyCollection).name === "string" &&
    typeof (value as AnyCollection).describe === "function" &&
    "schema" in value
  );
}

function isFunction(value: unknown): value is AnyGraftFunction {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AnyGraftFunction).name === "string" &&
    typeof (value as AnyGraftFunction).describe === "function" &&
    typeof (value as AnyGraftFunction).handler === "function" &&
    "schema" in value
  );
}

export async function loadConfig(configPath: string): Promise<ProjectConfig> {
  // moduleCache off so `graft dev` reloads pick up config edits; the transform
  // cache (fsCache) stays on — it is keyed by content, so edits still invalidate.
  const jiti = createJiti(configPath, { moduleCache: false });
  let mod: Record<string, unknown>;
  try {
    mod = (await jiti.import(configPath)) as Record<string, unknown>;
  } catch (error) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `Failed to load ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Fix the error in graft.config.ts — it must be importable and export `collections` (a record of defineCollection results).",
    });
  }

  const collections = mod.collections;
  if (typeof collections !== "object" || collections === null || Array.isArray(collections)) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `${configPath} does not export a \`collections\` record.`,
      fix: 'Add `export const collections = { … }` where each value is a defineCollection result from "@graft/core".',
    });
  }
  const entries = Object.entries(collections as Record<string, unknown>);
  if (entries.length === 0) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `${configPath} exports an empty \`collections\` record.`,
      fix: "Define at least one collection with defineCollection and include it in the exported `collections`.",
    });
  }
  for (const [key, value] of entries) {
    if (!isCollection(value)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `collections.${key} in ${configPath} is not a collection.`,
        fix: `Create it with defineCollection from "@graft/core" (it must have a name, a schema, and describe()).`,
        details: { key },
      });
    }
  }

  // functions are optional — content-only projects stay valid.
  let functions: Record<string, AnyGraftFunction> = {};
  if (mod.functions !== undefined) {
    if (typeof mod.functions !== "object" || mod.functions === null || Array.isArray(mod.functions)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `${configPath} exports \`functions\` but it is not a record.`,
        fix: 'Export `functions` as a record of defineFunction results, e.g. `export const functions = { pageStats }`, or omit the export.',
      });
    }
    const fnEntries = Object.entries(mod.functions as Record<string, unknown>);
    for (const [key, value] of fnEntries) {
      if (!isFunction(value)) {
        throw new GraftError({
          code: "CONFIG_INVALID",
          message: `functions.${key} in ${configPath} is not a function.`,
          fix: `Create it with defineFunction from "@graft/core" (it must have a name, a schema, a handler, and describe()).`,
          details: { key },
        });
      }
    }
    functions = mod.functions as Record<string, AnyGraftFunction>;
  }

  const projectDir = dirname(configPath);
  const contentDirSetting = typeof mod.contentDir === "string" ? mod.contentDir : "content";
  const migrationsDirSetting =
    typeof mod.migrationsDir === "string" ? mod.migrationsDir : "migrations";
  return {
    configPath,
    projectDir,
    contentDir: resolve(projectDir, contentDirSetting),
    migrationsDir: resolve(projectDir, migrationsDirSetting),
    collections: collections as Record<string, AnyCollection>,
    functions,
  };
}

/**
 * Load the nearest .env walking up from `startDir` (repo-root .env in the
 * monorepo case). Existing environment variables win over file values.
 */
export function loadProjectEnv(startDir: string): void {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        /* unreadable file — rely on the ambient environment */
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  throw new GraftError({
    code: "ENV_VAR_MISSING",
    message: "DATABASE_URL is not set.",
    fix: "Add DATABASE_URL=postgres://… to the project's .env (any parent directory works) or export it in the environment.",
    details: { variable: "DATABASE_URL" },
  });
}
