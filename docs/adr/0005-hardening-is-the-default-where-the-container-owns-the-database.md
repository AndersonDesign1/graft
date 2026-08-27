# 0005 — Hardening is the default where the container owns the database

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

`graft harden <role>` applies the Postgres privilege split behind the approval
gate: the runtime credential can file and consume approvals, and has no `UPDATE`
on `approvals`, so `pending → approved` is unreachable for it even with raw SQL.

It was opt-in, and `docs/design-notes/approval-hardening.md` recorded that as a
deliberate trade-off. The hardened role held `SELECT` on `content_index` and
`compilations` and nothing more, so a deployment that hardened lost MCP
`write_content` and `delete_content`. The note called hardened deployments
"functions/reads-first" and moved on.

Nobody pays that price. The result was a security layer that shipped, was
documented, and was applied to nothing.

The trade-off was also not buying what it looked like it was buying.
`write_content` writes the MDX file to disk and then compiles, and compile is the
step that reaches Postgres. Whoever holds the runtime credential could already
project content through the application. Withholding the grant removed a
feature. It did not remove a capability.

## Decision

Widen the grants so hardening costs a deployment nothing, then turn it on by
default where the container owns its own database.

`runtimeRoleGrantsSql` now grants `INSERT, UPDATE ON content_index` and
`INSERT ON compilations`. Removals are a soft delete, so `DELETE` stays
ungranted. `migrations_applied` stays operator-only: projecting content must not
imply being able to claim a migration ran.

`deploy/docker/entrypoint.sh` hardens by default in `GRAFT_MODE=all-in-one`,
generating a per-boot password when none is given. `GRAFT_MODE=serve` stays
opt-in via `GRAFT_HARDEN=1` or `GRAFT_RUNTIME_PASSWORD`. `GRAFT_HARDEN=0` turns
it off anywhere, and wins over a password left in a compose file.

Also considered and rejected: leaving the grants alone and running two
credentials, one for serving and one for MCP writes. `graft serve` is one
process with one `DATABASE_URL`, so that is two pools and a routing rule per
operation. It is a real feature, not a documentation fix, and it buys back a
denial that was not protecting anything.

## Premise

The one denial worth enforcing at the database layer is `UPDATE ON approvals`.
Every other grant exists to keep the split free, and a grant is only defensible
here while the application already exposes that capability to the runtime
credential by some other route.

**If a future tool lets the runtime credential do something through Postgres
that the application does not otherwise permit, this reasoning does not extend
to it.** Add the grant only alongside the application-level control, not ahead
of it.

The corollary points at ADR 0004: widening the runtime role's write access to
`content_index` widens the exact path `MdxBody`'s render-side check guards,
which is content arriving by direct database write rather than through a write
handler. That check is more load-bearing after this decision, not less, and
`trust: "restricted"` stays the default because of it.

## Consequences

- Breaking for anyone who already ran `graft harden`. Existing roles keep
  working with the old, narrower grants until the command is run again.
- A default `docker run` now serves under a credential that cannot approve its
  own destructive operation. That was the point of the layer, and it is the
  first release where the default deployment actually gets it.
- `packages/db/src/harden.test.ts` asserts the grant list directly. A widening
  typo there is not a failing feature, it is a runtime credential that can
  decide its own approval, so it fails in unit tests rather than in production.
- The integration test proves both halves against live Postgres: the hardened
  role projects and soft-deletes content, and is still refused on `approvals`,
  on `DELETE` from `content_index`, and on `migrations_applied`.
