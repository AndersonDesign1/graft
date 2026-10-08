---
"@usegraft/db": minor
"@usegraft/cli": patch
---

Concurrent `graft migrate --apply` runs apply each migration once.

The ledger was read before a run and written after it, so two runs started
together both saw a migration as pending and both applied it. The second then
failed on the ledger's unique index, after its content rewrite and data updates
had already run.

`@usegraft/db` exports `withMigrationLock(db, branchId, work)`. It holds a
transaction-scoped Postgres advisory lock for the branch while `work` runs.
`graft migrate --apply` reads the ledger only once it holds the lock, so a
second run waits for the first, then skips what the first applied.
`graft merge --apply` takes the same lock on its target branch, because it
writes that branch's ledger too.

The lock is transaction-scoped so it works behind a transaction-mode pooler
such as Neon's PgBouncer. A crashed run drops its connection, which ends the
transaction and frees the lock. There is no stale claim to clear.
