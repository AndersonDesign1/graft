---
"@usegraft/mcp": patch
---

Declare what every MCP tool does to the world, and answer with data as well as
prose.

All 18 tools now carry `ToolAnnotations` — the hints the protocol has had since
2025-03-26 and Graft shipped none of. Every tool looked identical to a client,
so `search_content` and `delete_content` were offered on the same terms, and a
client that asks a human before a destructive call had nothing to key on. Reads
are `readOnlyHint`, `delete_content` / `put_asset` / `decide_approval` /
`run_function` are `destructiveHint`, `write_content` is a non-destructive
change because git is its undo, and nothing claims an open world: the domain is
the collections a project declares.

These are hints and not a boundary, exactly as the spec says. Graft's real gates
are unchanged — the scope check, the one-shot input-bound approval, the Postgres
role separation. This makes an honest client's UX correct; it does not make a
dishonest one safe.

Tool results also carry `structuredContent` (MCP 2025-06-18) whenever the
payload is an object. Every tool already built a JS object and serialised it, so
each caller parsed the prose back into the shape it started as. The text block
is byte-identical, so a client that predates the field sees no change.

`@modelcontextprotocol/sdk` moves to ^1.30.0.
