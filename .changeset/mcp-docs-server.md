---
"@usegraft/mcp": patch
---

Add `createDocsMcp` / `createDocsMcpHandler`: a public, read-only documentation
MCP server, for `/mcp` on a docs domain.

It follows what docs platforms already publish. Mintlify generates a docs MCP at
`/mcp` for every site it hosts — public, unauthenticated, strictly read-only,
offering search plus navigating and reading the docs filesystem. Cloudflare runs
a documentation server separately from its authenticated API server. Agents
arrive expecting this shape.

The surface is `list_collections`, `list_content`, `get_content`,
`search_content`, `explain_error`, and the document resources. What is missing
is mostly not about writes: `describe_schema` carries the project's functions,
`list_registry` its owned primitives, and the branch, compilation and approval
listings its operations. Those are all reads, which is why "read-only" is the
wrong test for what belongs on a public endpoint.

It is a separate factory rather than a flag on `createGraftMcp`, so the
authenticated endpoint gains no new way to be opened. `DocsMcpOptions` omits
`functions`, `actor`, storage and approval elicitation outright, and
`createDocsMcpHandler` has no `allowAnonymous` escape because it has nothing to
authenticate.

Internally this splits the content tools into read and write registrations, the
introspection tools into collection and function halves, and the resources into
documents and schema. A mount whose whole purpose is public should not be one
`if` away from `write_content`.
