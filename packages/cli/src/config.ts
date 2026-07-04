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
import type { AnyCollection } from "@graft/core";
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
  collections: Record<string, AnyCollection>;
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

export async function loadConfig(configPath: string): Promise<ProjectConfig> {
  // Fresh instance + no caches so `graft dev` picks up config edits on reload.
  const jiti = createJiti(configPath, { moduleCache: false, fsCache: false });
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

  const projectDir = dirname(configPath);
  const contentDirSetting = typeof mod.contentDir === "string" ? mod.contentDir : "content";
  return {
    configPath,
    projectDir,
    contentDir: resolve(projectDir, contentDirSetting),
    collections: collections as Record<string, AnyCollection>,
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
