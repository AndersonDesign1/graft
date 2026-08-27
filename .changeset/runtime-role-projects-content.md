---
"@usegraft/db": minor
---

The hardened runtime role can project content, and the container hardens by
default.

`graft harden` denied the runtime role `INSERT`/`UPDATE` on `content_index` and
`compilations`, so hardening cost a deployment its MCP content writes. That made
the second layer of the approval gate something you traded a working feature
for, which is why it was opt-in and applied to nothing.

The denial was not buying what it looked like. `write_content` writes the MDX
file and then compiles, and compile is the step that reaches Postgres, so
whoever holds the runtime credential could already project content through the
application. Withholding the grant removed a feature, not a capability.

The property worth enforcing is narrower and untouched: no `UPDATE` on
`approvals`, so `pending → approved` stays unreachable for the runtime even with
raw SQL. Removals are a soft delete, so `DELETE` on `content_index` stays
ungranted, and `migrations_applied` stays operator-only.

**Breaking:**

- `runtimeRoleGrantsSql` emits two more `GRANT` statements. Re-run
  `graft harden <role>`; existing hardened roles keep working with the old,
  narrower grants until you do.
- The all-in-one container serves under the hardened runtime role by default.
  Set `GRAFT_HARDEN=0` for the previous behaviour. `GRAFT_MODE=serve` stays
  opt-in, because there the database is yours rather than the container's.

See `docs/adr/0005-hardening-is-the-default-where-the-container-owns-the-database.md`.
