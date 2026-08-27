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
import { GraftError, STATIC_INDEX_DEFAULT_PATH } from "@usegraft/contracts";
import type { AnyCollection, AnyGraftFunction } from "@usegraft/core";
import type { MdxTrust } from "@usegraft/mdx-safety";
import { createJiti } from "jiti";

export const CONFIG_FILENAMES = [
  "graft.config.ts",
  "graft.config.mts",
  "graft.config.js",
  "graft.config.mjs",
] as const;

/** Where the content index lives: Postgres (DATABASE_URL) or a SQLite artifact. */
export type IndexConfig =
  | { driver: "postgres" }
  | { driver: "static"; /** Absolute artifact path. */ path: string };

export interface ProjectConfig {
  configPath: string;
  /** The project root — the directory holding graft.config. */
  projectDir: string;
  /** Absolute path to the content root. */
  contentDir: string;
  /** Absolute path to the migrations directory (may not exist yet). */
  migrationsDir: string;
  /** From the optional `index` export; defaults to { driver: "postgres" }. */
  index: IndexConfig;
  collections: Record<string, AnyCollection>;
  /**
   * Typed functions exported from graft.config (optional). Used by `graft mcp`
   * for list_functions / run_function. Empty when the project has none.
   */
  functions: Record<string, AnyGraftFunction>;
  /**
   * From the optional `mdxTrust` export; defaults to "restricted". Governs what
   * `graft compile` accepts in an authored body, and matches MdxBody's own
   * default so a document that compiles is a document that renders.
   */
  mdxTrust: MdxTrust;
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
      fix: 'Add `export const collections = { … }` where each value is a defineCollection result from "@usegraft/core".',
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
        fix: `Create it with defineCollection from "@usegraft/core" (it must have a name, a schema, and describe()).`,
        details: { key },
      });
    }
  }

  // functions are optional — content-only projects stay valid.
  let functions: Record<string, AnyGraftFunction> = {};
  if (mod.functions !== undefined) {
    if (
      typeof mod.functions !== "object" ||
      mod.functions === null ||
      Array.isArray(mod.functions)
    ) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `${configPath} exports \`functions\` but it is not a record.`,
        fix: "Export `functions` as a record of defineFunction results, e.g. `export const functions = { pageStats }`, or omit the export.",
      });
    }
    const fnEntries = Object.entries(mod.functions as Record<string, unknown>);
    for (const [key, value] of fnEntries) {
      if (!isFunction(value)) {
        throw new GraftError({
          code: "CONFIG_INVALID",
          message: `functions.${key} in ${configPath} is not a function.`,
          fix: `Create it with defineFunction from "@usegraft/core" (it must have a name, a schema, a handler, and describe()).`,
          details: { key },
        });
      }
    }
    functions = mod.functions as Record<string, AnyGraftFunction>;
  }

  const projectDir = dirname(configPath);
  const index = parseIndexConfig(mod.index, projectDir, configPath);
  assertStaticSupports(index, collections as Record<string, AnyCollection>, functions, configPath);
  const mdxTrust = parseMdxTrust(mod.mdxTrust, configPath);
  const contentDirSetting = typeof mod.contentDir === "string" ? mod.contentDir : "content";
  const migrationsDirSetting =
    typeof mod.migrationsDir === "string" ? mod.migrationsDir : "migrations";
  return {
    configPath,
    projectDir,
    contentDir: resolve(projectDir, contentDirSetting),
    migrationsDir: resolve(projectDir, migrationsDirSetting),
    index,
    collections: collections as Record<string, AnyCollection>,
    functions,
    mdxTrust,
  };
}

/**
 * Read the optional `mdxTrust` export. Anything other than the two known values
 * is refused rather than defaulted: a typo here would silently re-enable the
 * restriction someone was deliberately turning off, or the reverse.
 */
function parseMdxTrust(value: unknown, configPath: string): MdxTrust {
  if (value === undefined) return "restricted";
  if (value === "restricted" || value === "full") return value;
  throw new GraftError({
    code: "CONFIG_INVALID",
    message: `${configPath} exports \`mdxTrust\` as ${JSON.stringify(value)}, which is not "restricted" or "full".`,
    fix: 'Export `mdxTrust = "restricted"` (the default: `{…}` expressions and `import` are refused in authored bodies) or `mdxTrust = "full"` (every author has commit access, so code review is the control). Omit the export to keep the default.',
    details: { mdxTrust: value },
  });
}

/**
 * The static/Postgres boundary, enforced where a project is loaded rather than
 * where it eventually breaks. Static mode indexes authored content only:
 * operational data (db-authoritative collections) and typed functions are
 * Postgres-tier by construction, so declaring them alongside a static index is
 * a project that cannot work — and the moment to teach the upgrade.
 */
function assertStaticSupports(
  index: IndexConfig,
  collections: Record<string, AnyCollection>,
  functions: Record<string, AnyGraftFunction>,
  configPath: string,
): void {
  if (index.driver !== "static") return;

  const dbCollections = Object.values(collections)
    .filter((collection) => collection.authority === "db-authoritative")
    .map((collection) => collection.name);
  const functionNames = Object.keys(functions);
  if (dbCollections.length === 0 && functionNames.length === 0) return;

  const needs = [
    dbCollections.length > 0
      ? `db-authoritative collection(s) ${dbCollections.map((n) => `"${n}"`).join(", ")}`
      : "",
    functionNames.length > 0
      ? `typed function(s) ${functionNames.map((n) => `"${n}"`).join(", ")}`
      : "",
  ].filter(Boolean);

  throw new GraftError({
    code: "NEEDS_DATABASE",
    message: `${configPath} uses the static index, but declares ${needs.join(" and ")} — those live in Postgres, not in the compiled artifact.`,
    fix: 'Upgrade this project to the Postgres tier: set DATABASE_URL in .env, change graft.config to `export const index = "postgres"`, run `graft db migrate`, then `graft compile`. To stay service-free instead, remove the db-authoritative collections and functions (a `graft add` primitive that brought them can be deleted from graft/).',
    details: { dbCollections, functions: functionNames },
  });
}

function parseIndexConfig(value: unknown, projectDir: string, configPath: string): IndexConfig {
  if (value === undefined || value === "postgres") return { driver: "postgres" };
  if (value === "static") {
    return { driver: "static", path: resolve(projectDir, STATIC_INDEX_DEFAULT_PATH) };
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const driver = (value as { driver?: unknown }).driver;
    const path = (value as { path?: unknown }).path;
    if (driver === "postgres") return { driver: "postgres" };
    if (driver === "static" && (path === undefined || typeof path === "string")) {
      return { driver: "static", path: resolve(projectDir, path ?? STATIC_INDEX_DEFAULT_PATH) };
    }
  }
  throw new GraftError({
    code: "CONFIG_INVALID",
    message: `${configPath} exports an invalid \`index\` setting.`,
    fix: `Use \`export const index = "static"\` (SQLite artifact, zero services), \`"postgres"\` (DATABASE_URL — the default when omitted), or { driver: "static", path: "…" }.`,
    details: { index: value },
  });
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
