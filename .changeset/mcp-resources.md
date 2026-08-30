---
"@usegraft/mcp": patch
---

Serve authored documents and the project schema as MCP resources.

A tool call is a request to do something; a resource is a thing that exists,
addressed by URI, which a client can list and attach to a conversation without
spending a turn deciding to. Graft's documents were reachable only as tool
output, so attaching one meant an agent calling `get_content` and pasting the
answer — and they are files with stable paths, the most resource-shaped thing
in the product.

URIs are `graft://<branch>/<collection>/<slug>`, with the branch baked into the
template rather than left as a variable a server would only have to refuse.
Reads come from the authored files, not the index, so a resource reflects the
working tree rather than the last compile, and works on a static project with
no database. `graft://<branch>/schema` serves the same payload as
`describe_schema`, for attaching once instead of fetching each time.

The template's URI variables autocomplete from what exists, and the slug list
narrows to the collection already chosen.

Also adds `guardedResource`, so a failed resource read carries its `fix`. A
tool failure is a value that can hold the code, the fix and the recovery text;
a resource read has no such envelope, and a GraftError escaping raw arrived
with its fix stripped off.
