/**
 * The `neon` branch backend — physical copy-on-write branches on Neon
 * (validated live 2026-07-07; see docs/design-notes/branching.md).
 *
 * A neon branch is its own Postgres: the Neon API forks the parent's storage
 * and mints a dedicated compute endpoint. Inside the fork there is no
 * branch_id scoping — rows keep the default `main` id, and the `physical`
 * BranchScope reads/writes exactly that.
 *
 * Two deliberate deviations from a raw storage fork (the "previews inherit
 * content, never operational data" decision):
 * - `data_records` is CLEARED on create. Operational data (submissions,
 *   orders) belongs to the environment, not the code version — PII stays out
 *   of previews, merge stays additive, and the overlay backend (whose data
 *   reads are exact-branch) means the same thing.
 * - `approvals` is CLEARED on create. A one-shot approval consumed on a fork
 *   would not mark the parent's copy consumed — clearing prevents a gated
 *   destructive op from executing once per fork. `audit_log` stays: history.
 */
import { GraftError } from "@graft/contracts";
import {
  assertBranchCreatable,
  assertBranchDroppable,
  neonBranchUrl,
  type BranchMeta,
} from "./branch";
import { createDb, type Database } from "./client";
import { approvals, branches, dataRecords } from "./schema";
import { eq } from "drizzle-orm";

const DEFAULT_API_URL = "https://console.neon.tech/api/v2";

export interface NeonConfig {
  apiKey: string;
  /** The Neon project id (from the console URL). Keys may be project-scoped, so this is never discovered by listing. */
  projectId: string;
  /** Override for tests. */
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Read the neon backend's config from the environment; `ENV_VAR_MISSING` with a fix otherwise. */
export function neonConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): NeonConfig {
  const apiKey = env.NEON_API_KEY;
  if (!apiKey) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "NEON_API_KEY is not set — the neon branch backend needs it.",
      fix: "Create an API key at console.neon.tech → Account settings → API keys (a project-scoped key is fine) and add NEON_API_KEY=… to .env.",
      details: { variable: "NEON_API_KEY" },
    });
  }
  const projectId = env.GRAFT_NEON_PROJECT_ID;
  if (!projectId) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "GRAFT_NEON_PROJECT_ID is not set — the neon branch backend needs it.",
      fix: "Add GRAFT_NEON_PROJECT_ID=<project id> to .env (the id from the Neon console URL, e.g. dark-pine-91155521). Keys can be project-scoped, so the project cannot be discovered by listing.",
      details: { variable: "GRAFT_NEON_PROJECT_ID" },
    });
  }
  return { apiKey, projectId };
}

interface NeonOperation {
  id: string;
  status?: string;
  action?: string;
}

async function neonApi<T>(
  config: NeonConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.apiUrl ?? DEFAULT_API_URL;
  let res: Response;
  try {
    res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new GraftError({
      code: "BRANCH_BACKEND_FAILED",
      message: `Neon API unreachable (${method} ${path}): ${error instanceof Error ? error.message : String(error)}`,
      fix: "Check network access to console.neon.tech and retry.",
      details: { method, path },
    });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new GraftError({
      code: "BRANCH_BACKEND_FAILED",
      message: `Neon API ${method} ${path} failed with ${res.status}: ${text.slice(0, 500)}`,
      fix: "Check NEON_API_KEY (valid? scoped to this project?) and GRAFT_NEON_PROJECT_ID, then retry. 4xx responses usually name the exact problem.",
      details: { method, path, status: res.status },
    });
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitForOperations(
  config: NeonConfig,
  operations: NeonOperation[] | undefined,
): Promise<void> {
  for (const op of operations ?? []) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const { operation } = await neonApi<{ operation: NeonOperation }>(
        config,
        "GET",
        `/projects/${config.projectId}/operations/${op.id}`,
      );
      if (operation.status === "finished") break;
      if (operation.status === "failed") {
        throw new GraftError({
          code: "BRANCH_BACKEND_FAILED",
          message: `Neon operation ${operation.action ?? op.id} failed.`,
          fix: "Check the branch's state in the Neon console; drop and recreate if it is half-created.",
          details: { operation: op.id },
        });
      }
      await sleep(500);
    }
  }
}

export interface CreateNeonBranchInput {
  name: string;
  /** The branch to fork from. Defaults to "main". Must be main or another neon branch. */
  from?: string;
  /** The control-plane connection URL whose credentials the fork inherits. */
  databaseUrl: string;
}

interface NeonBranchResponse {
  branch: { id: string; name: string };
  endpoints?: Array<{ host?: string }>;
  operations?: NeonOperation[];
}

/**
 * Fork a Neon branch: API create (parent's storage, own compute endpoint),
 * wait until the inherited role answers (~5s observed), clear operational
 * data + approvals (empty-preview semantics), then register the branch.
 * On a partway failure the Neon branch is deleted best-effort so the registry
 * and Neon never disagree silently.
 */
export async function createNeonBranch(
  db: Database,
  input: CreateNeonBranchInput,
  config: NeonConfig,
): Promise<BranchMeta> {
  const from = input.from ?? "main";
  const parent = await assertBranchCreatable(db, { name: input.name, from });

  // A neon branch forks physical storage. Overlay branches have no physical
  // form of their own (their rows live inside the parent DB under another
  // branch_id, which a physical scope never reads) — so only main (the DB
  // itself) or another neon branch can be a parent.
  if (parent.backend !== "neon" && parent.name !== "main") {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `Cannot fork a neon branch from overlay branch "${from}" — it has no physical storage of its own.`,
      fix: "Fork from main or from another neon branch. (Overlay and neon branches can coexist, but a physical fork can only fork a physical database.)",
      details: { name: input.name, from },
    });
  }

  const created = await neonApi<NeonBranchResponse>(
    config,
    "POST",
    `/projects/${config.projectId}/branches`,
    {
      branch: {
        name: input.name,
        // Omitted for main: Neon forks the project's default branch.
        ...(parent.neonBranchId ? { parent_id: parent.neonBranchId } : {}),
      },
      endpoints: [{ type: "read_write" }],
    },
  );

  const cleanupNeon = async (): Promise<void> => {
    try {
      await neonApi(
        config,
        "DELETE",
        `/projects/${config.projectId}/branches/${created.branch.id}`,
      );
    } catch {
      /* reported via the original error's fix */
    }
  };

  try {
    const endpointHost = created.endpoints?.[0]?.host;
    if (!endpointHost) {
      throw new GraftError({
        code: "BRANCH_BACKEND_FAILED",
        message: `Neon created branch "${input.name}" but returned no endpoint host.`,
        fix: "Retry the create. If the branch lingers in the Neon console without an endpoint, delete it there first.",
        details: { name: input.name, neonBranchId: created.branch.id },
      });
    }

    await waitForOperations(config, created.operations);

    // Connect with the inherited role, then enforce empty-preview semantics.
    const fork = createDb(neonBranchUrl(input.databaseUrl, endpointHost));
    try {
      let connected = false;
      for (let attempt = 0; attempt < 30 && !connected; attempt++) {
        try {
          await fork.sql`SELECT 1`;
          connected = true;
        } catch {
          await sleep(1000);
        }
      }
      if (!connected) {
        throw new GraftError({
          code: "BRANCH_BACKEND_FAILED",
          message: `Branch "${input.name}" was created but its endpoint ${endpointHost} never accepted a connection.`,
          fix: "Check the branch's compute state in the Neon console, then drop and recreate.",
          details: { name: input.name, endpointHost },
        });
      }
      await fork.db.delete(dataRecords);
      await fork.db.delete(approvals);
    } finally {
      await fork.close();
    }

    const [row] = await db
      .insert(branches)
      .values({
        name: input.name,
        parent: from,
        backend: "neon",
        endpointHost,
        neonBranchId: created.branch.id,
      })
      .returning();
    if (!row) throw new Error("insert returned no row"); // unreachable; satisfies noUncheckedIndexedAccess
    return {
      name: row.name,
      parent: row.parent,
      backend: "neon",
      status: row.status,
      createdAt: row.createdAt,
      endpointHost: row.endpointHost,
      neonBranchId: row.neonBranchId,
    };
  } catch (error) {
    await cleanupNeon();
    throw error;
  }
}

/**
 * Drop a neon branch: registry guards, Neon API delete (branch + endpoint),
 * then the registry row. A branch already gone on the Neon side (404) still
 * gets its registry row removed — the registry converges on reality.
 */
export async function dropNeonBranch(
  db: Database,
  name: string,
  config: NeonConfig,
): Promise<void> {
  const meta = await assertBranchDroppable(db, name);
  if (meta.backend !== "neon") {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `Branch "${name}" is an overlay branch — dropNeonBranch only handles neon branches.`,
      fix: "Use dropBranch (graft branch drop routes automatically).",
      details: { name },
    });
  }

  if (meta.neonBranchId) {
    try {
      const dropped = await neonApi<{ operations?: NeonOperation[] }>(
        config,
        "DELETE",
        `/projects/${config.projectId}/branches/${meta.neonBranchId}`,
      );
      await waitForOperations(config, dropped.operations);
    } catch (error) {
      const status =
        error instanceof GraftError ? (error.details as { status?: number })?.status : undefined;
      if (status !== 404) throw error; // already gone on the Neon side → converge
    }
  }

  await db.delete(branches).where(eq(branches.name, name));
}
