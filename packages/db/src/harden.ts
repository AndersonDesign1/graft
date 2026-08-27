/**
 * Runtime-role hardening — the Postgres privilege split behind the approval gate.
 *
 * Two credentials, two jobs:
 * - **Operator** (the migrating/owner role): compiles, migrates, branches,
 *   merges, and DECIDES approvals (`graft approve` — a plain UPDATE on
 *   `approvals`).
 * - **Runtime** (what a deployed app / autonomous agent holds): serves reads,
 *   runs functions, projects authored content, files approval requests, and
 *   consumes approved ones via the SECURITY DEFINER `graft_consume_approval`
 *   (migration 0007). It has NO UPDATE on `approvals`, so `pending → approved`
 *   is unreachable for it, even with raw SQL against its own DATABASE_URL.
 *
 * That one denial is the whole point of the split. The grants are otherwise
 * wide enough that hardening costs a deployment nothing, which is why the
 * container can apply it by default rather than as an opt-in that trades a
 * working feature for a second layer.
 *
 * `runtimeRoleGrantsSql` emits the grants for such a role;
 * `hardenRuntimeRole` applies them over an operator connection. Creating the
 * role itself (name, password, LOGIN) stays with the operator / platform —
 * e.g. `CREATE ROLE graft_runtime LOGIN PASSWORD '…'` or the Neon console.
 */
import { sql } from "drizzle-orm";
import { GraftError } from "@usegraft/contracts";
import type { Database } from "./client";

/** Postgres identifier we're willing to splice into DDL. */
const ROLE_RE = /^[a-z_][a-z0-9_$]*$/i;

function assertRoleName(role: string): void {
  if (!ROLE_RE.test(role)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${role}" is not a plain Postgres role name.`,
      fix: "Use an unquoted identifier: letters, digits, and underscores, starting with a letter or underscore (e.g. graft_runtime).",
      details: { role },
    });
  }
}

/**
 * The grant statements that make `role` a runtime credential: serve content,
 * run functions, project authored content, write operational data, audit
 * itself, request and consume approvals. It may never decide an approval.
 *
 * Schema changes stay operator work: no CREATE, no DDL, no `migrations_applied`
 * write. Branch create/merge stays operator work too.
 */
export function runtimeRoleGrantsSql(role: string): string[] {
  assertRoleName(role);
  return [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    // Reads: every Graft table is readable (content, scope resolution, rate
    // counting, approval diagnostics, ledgers).
    `GRANT SELECT ON TABLE content_index, compilations, data_records, audit_log, approvals, migrations_applied, branches TO ${role}`,
    // Operational data is the runtime's to mutate (typed functions).
    `GRANT INSERT, UPDATE, DELETE ON TABLE data_records TO ${role}`,
    // Content projection. `write_content`/`delete_content` write the MDX file
    // and then compile, and compile is the step that reaches Postgres. The
    // application already exposes that to whoever holds the runtime
    // credential, so withholding it here never removed the capability — it
    // only broke MCP content writes for anyone who hardened. Removals are a
    // soft delete (an UPDATE of `deleted`), so DELETE stays ungranted.
    `GRANT INSERT, UPDATE ON TABLE content_index TO ${role}`,
    `GRANT INSERT ON TABLE compilations TO ${role}`,
    // Every invocation audits itself. The row is reserved before the call runs
    // (that is what makes rate limiting immune to concurrency), then settled
    // with its outcome — so the runtime needs UPDATE as well as INSERT.
    // Column-scoped deliberately: it may stamp how a call ENDED, never rewrite
    // who made it, which function it was, or what it counted against.
    `GRANT INSERT ON TABLE audit_log TO ${role}`,
    `GRANT UPDATE (status, duration_ms) ON TABLE audit_log TO ${role}`,
    // It may FILE approval requests — deciding them requires UPDATE, which is
    // deliberately absent; consuming rides the SECURITY DEFINER function.
    `GRANT INSERT ON TABLE approvals TO ${role}`,
    `GRANT EXECUTE ON FUNCTION graft_consume_approval(uuid, text, text) TO ${role}`,
  ];
}

/**
 * Apply {@link runtimeRoleGrantsSql} over an operator/owner connection. The
 * role must already exist (`CREATE ROLE <name> LOGIN PASSWORD '…'`).
 */
export async function hardenRuntimeRole(db: Database, role: string): Promise<string[]> {
  const statements = runtimeRoleGrantsSql(role);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
  return statements;
}
