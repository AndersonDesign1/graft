---
"@usegraft/contracts": patch
"@usegraft/core": patch
"@usegraft/mcp": patch
"@usegraft/studio": patch
"@usegraft/cli": patch
---

Every route that reads a request body now stops at a limit and answers `413`
with the new `PAYLOAD_TOO_LARGE` error. Before, the functions route, MCP,
Studio and `graft serve`'s Node adapter all buffered whatever arrived, so one
large unauthenticated POST was held in memory before any check on it ran.

| Route                                                 | Default limit                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Functions (`createFunctionsHandler`) and Studio's API | 1 MiB, and 14 MiB for a Studio asset upload (10 MB as base64) |
| MCP (`createGraftMcpHandler`)                         | 32 MiB, which fits a 24 MB file sent to `put_asset` as base64 |
| A public docs MCP (`createDocsMcpHandler`)            | 1 MiB                                                         |
| `graft serve`, before routing                         | 32 MiB                                                        |

A request that declares a larger `Content-Length` is refused without reading a
byte, and one that sends no length is cut off as soon as it passes the limit.
MCP reads the body only after the caller authenticates. A refused function call
still counts against the caller's rate limit. `run_function` arguments are
bounded by the MCP limit, not the functions route's, since they arrive inside
an MCP message.

Raise or lower a limit with `maxBodyBytes` on the handler:

```ts
createFunctionsHandler({ functions, db, maxBodyBytes: 4 * 1024 * 1024 });
createGraftMcpHandler({ contentDir, db, collections, actor, maxBodyBytes: 64 * 1024 * 1024 });
createStudioHandler({ /* … */ maxBodyBytes: 4 * 1024 * 1024 });
```

`graft serve` takes `--max-body-bytes` (or `GRAFT_MAX_BODY_BYTES`), which sets
one limit for the functions route, MCP, Studio and the server itself.

The functions route and Studio answer with the `PAYLOAD_TOO_LARGE` error; MCP
answers with a JSON-RPC error, code `-32600`. `graft serve` no longer buffers a
body before routing: it streams it to the route, cut off at its own 32 MiB
ceiling, so a function call refused at 1 MiB stops the read there. A limit that
is not a whole number of bytes (`NaN`, `Infinity`, a negative number) is
refused with `CONFIG_INVALID` when the handler is built, rather than quietly
disabling the check.

`@usegraft/contracts` exports shared body-reading helpers, `readBodyText`,
`readBodyBytes` and `bodyLimit`, with `DEFAULT_MAX_BODY_BYTES` and
`DEFAULT_MAX_MCP_BODY_BYTES`. An adapter that reads a body itself can use them
to enforce the same limit.
