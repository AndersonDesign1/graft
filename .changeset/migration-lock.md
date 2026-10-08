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
`graft merge --apply` takes the same lock on both branches, in a fixed order:
it writes the target's ledger, and reads the source's, so no migration can land
on the source while its rows move.

The lock is transaction-scoped so it works behind a transaction-mode pooler
such as Neon's PgBouncer. A crashed run drops its connection, which ends the
transaction and frees the lock. There is no stale claim to clear.

The lock's transaction pings every 10 seconds while the run works, so an
idle-in-transaction timeout longer than that does not end it early. It needs a
pool of at least two connections, one for the lock and one for the work, and
refuses a smaller pool up front instead of waiting on itself.
