/**
 * Which storage engine a Nuxt app reads, from graft.config.ts's `index` export
 * and the runtime config. The same rule `graft compile` uses: `"static"` opens
 * the SQLite artifact, anything else is Postgres. Validated here rather than
 * trusted, because the export is user code. No Nuxt imports, so it is tested
 * on its own.
 */
import { resolve } from "node:path";
import { GraftError, STATIC_INDEX_DEFAULT_PATH } from "@usegraft/contracts";

export type Engine =
  | { readonly kind: "static"; readonly path: string }
  | { readonly kind: "postgres"; readonly url: string };

/**
 * Which engine to open, from graft.config.ts's `index` export and the runtime
 * config. Validated here rather than trusted, because the export is user code.
 */
export function engineFor(
  index: unknown,
  runtime: { readonly databaseUrl?: string; readonly staticIndex?: string },
  env: NodeJS.ProcessEnv,
  cwd: string,
): Engine {
  const staticPath = (configured: string | undefined): Engine => ({
    kind: "static",
    path: resolve(cwd, runtime.staticIndex || configured || STATIC_INDEX_DEFAULT_PATH),
  });
  if (index === "static") return staticPath(undefined);
  if (typeof index === "object" && index !== null && !Array.isArray(index)) {
    const driver = "driver" in index ? index.driver : undefined;
    const path = "path" in index ? index.path : undefined;
    if (driver === "static" && (path === undefined || typeof path === "string")) {
      return staticPath(path);
    }
    if (driver !== "postgres") throw invalidIndex(index);
  } else if (index !== undefined && index !== "postgres") {
    throw invalidIndex(index);
  }
  const url = runtime.databaseUrl || env.DATABASE_URL || "";
  if (url === "") {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "graft.config.ts uses the Postgres engine, and no database URL is set.",
      fix: 'Set NUXT_GRAFT_DATABASE_URL (or DATABASE_URL) for the server, or set `export const index = "static"` in graft.config.ts and run `graft compile` to read the static index instead.',
    });
  }
  return { kind: "postgres", url };
}

function invalidIndex(index: unknown): GraftError {
  return new GraftError({
    code: "CONFIG_INVALID",
    message: "graft.config.ts exports an invalid `index` setting.",
    fix: 'Use `export const index = "static"` (SQLite artifact, zero services), `"postgres"` (DATABASE_URL, the default when omitted), or { driver: "static", path: "…" }.',
    details: { index },
  });
}
