# @usegraft/mcp

> An MCP server over your content, schema, and typed functions, with errors an agent can act on.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/mcp
```

## Serve on stdio

For `.mcp.json` and local agents. `graft mcp` does this for you.

```ts
import { createGraftMcp, serveStdio } from "@usegraft/mcp";

const server = createGraftMcp({ contentDir, collections, functions, db });
await serveStdio(server);
```

## Serve over HTTP

```ts
import { createGraftMcpHandler } from "@usegraft/mcp";

export const POST = createGraftMcpHandler({
  contentDir,
  collections,
  db,
  actor: resolveActor,
  connectionActor: resolveConnectionActor,
});
```

`connectionActor` is not optional in practice. Without it every write-tool scope check is silently disabled, so pass it whenever a tool can write.

## Tools

Content: `list_content`, `read_content`, `write_content`, `delete_content`, `search_content`. Introspection: `describe_schema`, `list_functions`, `describe_function`. Execution: `run_function`. Registry: `list_registry`, `describe_item`. Approvals: `list_approvals`, `decide_approval`.

## Defaults that fail closed

- Anonymous callers are refused unless explicitly allowed.
- `write_content` requires the `content:write` scope, and being authenticated earns nothing on its own.
- `delete_content` is destructive and always human-gated: the first call files an approval and fails with its id.
- Authored MDX is refused if it contains `{…}` expressions, `import`, `export` or spread attributes, because rendering evaluates MDX as JavaScript on the server.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/feat/core/packages/mcp/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/feat/core/SECURITY.md)
