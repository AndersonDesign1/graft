---
"@usegraft/db": minor
---

An approval is filed pending by construction.

Migration `0009_pending_by_construction` adds a `CHECK` on `approvals.status`
and a `BEFORE INSERT` trigger that refuses any insert naming a status other
than `'pending'`, or carrying a decision in `decided_by`, `decided_at`,
`decided_role` or `decided_by_kind`.

The column-scoped INSERT grant already stopped a hardened runtime role from
filing an approved approval. That is a grant list, and a grant list is a thing
someone edits. This puts the same rule in the table, so it holds for every role
including the owner, and no future change to `runtimeRoleGrantsSql` can quietly
reopen it.

The trigger raises rather than coercing the row to `'pending'`. A caller trying
to file a decision has a bug or is an attacker, and silently rewriting the row
would hide both.

Deciding is an `UPDATE` and is untouched.

**Requires a migration.** Run `graft db migrate` (or
`node packages/db/scripts/migrate.mjs`) before serving on an existing database.
