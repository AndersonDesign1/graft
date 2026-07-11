# Design notes

Durable design decisions and spike findings live here, one file per topic.

| Note                                               | Topic                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`branching.md`](./branching.md)                   | Copy-on-write Postgres branching: Neon CoW default + self-host overlay fallback |
| [`content-projection.md`](./content-projection.md) | Authored content → Postgres index (atomic, deterministic projection)            |
| [`registry.md`](./registry.md)                     | Owned primitives + `graft add` wiring (barrel, not plugins)                     |
| [`agent-mcp.md`](./agent-mcp.md)                   | Project MCP: install UX, function tools, safety defaults, non-goals             |
| [`approval-hardening.md`](./approval-hardening.md) | Approval gate vs autonomous agents: Postgres role separation, self-decision     |

These notes hand off throwaway spikes and research into real package APIs.
