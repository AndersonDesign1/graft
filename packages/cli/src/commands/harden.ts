/**
 * graft harden <role> — apply the runtime-role privilege split (operator command).
 *
 * Grants an existing Postgres role exactly what a deployed app / autonomous
 * agent needs (serve reads, run functions, mutate data_records, audit itself,
 * request + consume approvals) and nothing that could decide an approval or
 * rewrite projections — the two-credential model from
 * docs/design-notes/approval-hardening.md. Run it with the OPERATOR
 * DATABASE_URL; hand the hardened role's URL to the deployment.
 */
import { loadProjectEnv, requireDatabaseUrl } from "../config";

export interface HardenCommandOptions {
  cwd: string;
  role: string;
}

export interface HardenResult {
  role: string;
  statements: string[];
}

export async function hardenCommand(options: HardenCommandOptions): Promise<HardenResult> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const [{ createDb, hardenRuntimeRole }, { GraftError }] = await Promise.all([
    import("@usegraft/db"),
    import("@usegraft/contracts"),
  ]);
  const handle = createDb(url);
  try {
    const statements = await hardenRuntimeRole(handle.db, options.role);
    return { role: options.role, statements };
  } catch (error) {
    if (error instanceof GraftError) throw error;
    // 42704 undefined_object — the role does not exist yet. Drizzle wraps the
    // PostgresError, so walk the cause chain for the SQLSTATE.
    let code: string | undefined;
    for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as never) {
      if (typeof e.code === "string") {
        code = e.code;
        break;
      }
    }
    if (code === "42704") {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: `Role "${options.role}" does not exist in this database.`,
        fix: `Create it first (as the operator): CREATE ROLE ${options.role} LOGIN PASSWORD '…' — or via your provider's console — then rerun \`graft harden ${options.role}\`.`,
        details: { role: options.role },
      });
    }
    throw error;
  } finally {
    await handle.close();
  }
}
