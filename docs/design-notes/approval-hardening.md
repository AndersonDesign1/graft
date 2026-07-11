# Approval-gate hardening — role separation (post-P6)

**Status: SHIPPED** (migration `0007`; `@graft/db` `approvals.ts` + `harden.ts`).

## The gap this closes

The P3.4 destructive-op gate was structurally sound for **remote** agents — no
approve surface exists over MCP/HTTP; `decideApproval` is CLI-only. But a
**local agent with shell access and `DATABASE_URL`** could self-approve:
`graft approve <id>` needed nothing but that URL, `decided_by` was a
self-reported OS username, and with raw SQL it didn't even need the CLI. In the
P6.5 live exercise, only the _harness's_ permission classifier stopped the
orchestrating assistant from stamping its own subagent's request — a harness
property, not a Graft one. This unit makes it a Graft property.

## The model: two credentials, two jobs

| Credential                          | Holds                               | Can                                                                                                               | Cannot                                                                      |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Operator** (owner/migrating role) | the human / CI                      | compile, migrate, branch, merge, **decide** approvals                                                             | —                                                                           |
| **Runtime** (hardened role)         | the deployed app / autonomous agent | serve reads, run functions, mutate `data_records`, audit itself, **request** approvals, **consume** approved ones | decide approvals (`UPDATE approvals` is never granted), rewrite projections |

Single-credential local dev keeps working unchanged — the owner role can do
everything, and the gate's job there is stopping accidents plus audit, which
the separation-of-duties check still covers.

## The three mechanisms

1. **Consume rides `SECURITY DEFINER`** (migration `0007`). The one status
   flip a runtime credential legitimately performs — `approved → consumed`,
   bound to the exact function + canonical input — moved into
   `graft_consume_approval(uuid, text, text)`, owned by the migrating role and
   EXECUTE-granted to PUBLIC (consuming only ever downgrades an approval a
   human already granted). `createDbApprovalStore.consume` calls it; the
   diagnostics (`pending` / `denied` / `already_consumed` / `mismatch` /
   `not_found`) come back as its return value.

2. **Deciding stays a plain table `UPDATE`** — deliberately. `decideApproval`
   (what `graft approve` / `graft deny` call) updates `approvals` directly, so
   a role without `UPDATE` on that table gets `permission denied` from
   Postgres itself. No policy layer to bypass: raw SQL with the runtime
   credential cannot reach `pending → approved`. Decisions also stamp
   **`decided_role = current_user`** inside the UPDATE — a verified record of
   the credential used, unlike the self-reported `decided_by`.

3. **Separation of duties.** The decide UPDATE's WHERE clause refuses rows
   whose `requested_by_id` equals the deciding identity; the diagnostic path
   throws `APPROVAL_SELF_DECISION` (new contracts code + explain entry). This
   is belt-and-suspenders — identities are self-reported at the CLI — but it
   makes intent explicit and blocks the naive same-identity path; the durable
   guard is mechanism 2.

## Provisioning a runtime role

`@graft/db` exports the grants (`runtimeRoleGrantsSql(role)`) and an applier
(`hardenRuntimeRole(db, role)`, run over an operator connection). Creating the
role itself (LOGIN, password) stays with the operator/platform — e.g.
`CREATE ROLE graft_runtime LOGIN PASSWORD '…'` or the Neon console. The grants:

- `USAGE` on schema `public`; `SELECT` on every Graft table (content, scope
  resolution, rate counting, approval diagnostics, ledgers);
- `INSERT/UPDATE/DELETE` on `data_records` (typed functions own operational
  data);
- `INSERT` on `audit_log` (every invocation audits itself);
- `INSERT` on `approvals` (filing requests) + `EXECUTE` on
  `graft_consume_approval` — and **no** `UPDATE` on `approvals`.

Compile/migrate/branch/merge write other tables, so a deployment where the
_app_ compiles at runtime (dev, `graft dev`) uses the operator credential —
which is fine: hardening matters exactly when an autonomous agent holds the
runtime credential and the human holds the operator one.

## Verified live (2026-07-11, Neon PG18)

Integration test (`audit.integration.test.ts`): a hardened NOLOGIN role under
`SET LOCAL ROLE` gets `permission denied for table approvals` on the raw
status-flip UPDATE; the same role consumes an operator-approved row through
the definer function (`ok`); `decided_role` comes back as the connection's
`current_user`; approver == requester throws `APPROVAL_SELF_DECISION` and
leaves the row pending. PG16+ note: the creator needs an explicit
`GRANT <role> TO current_user` before `SET ROLE` (CREATEROLE no longer implies
SET-able membership), and Neon refuses `DROP OWNED BY` — revoke explicit
grants before `DROP ROLE`.

## Deferred

- **`graft harden <role>` CLI** — the exported helpers wrapped as an operator
  command (create role + password handling included). Do when Phase 7 deploy
  adapters make provisioning a recurring task.
- **Authenticated CLI approver** — resolving `graft approve` through
  `@graft/auth` (dev token / OIDC) so `decided_by` is verified too, not just
  `decided_role`. Needs a CLI-side resolver config story.
- **Out-of-band approval UX** (Studio / notifications) — rides the deferred
  Studio work.
