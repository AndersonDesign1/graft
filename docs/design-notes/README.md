# Design notes

Durable design decisions and spike findings live here, one file per topic.

Phase 1 will add:

- `branching.md` — copy-on-write Postgres branching: failure catalog (sequences,
  extensions, roles, pooling) and the chosen default (Neon CoW) + self-host fallback
  (`branch_id` row isolation).
- `content-projection.md` — how authored content files are projected into the Postgres
  index, atomically and deterministically.

These notes are the hand-off from throwaway spikes to the real `@graft/db` and
`@graft/compiler` implementations.
