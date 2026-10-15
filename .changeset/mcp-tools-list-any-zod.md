---
"@usegraft/mcp": patch
"@usegraft/auth": patch
"@usegraft/cli": patch
"@usegraft/studio": patch
---

`tools/list` no longer fails with "Cannot read properties of undefined (reading 'push')" when the MCP SDK resolves an older zod than Graft's. The SDK takes any zod from 3.25 on, so a project whose own dependencies bring zod 4.2 to 4.4 handed the SDK a converter that crashed on Graft's schemas. Calling a tool by name still worked, but standard clients list tools first, so none of them could connect. The listing is now converted with the zod that built the schemas, and is otherwise the SDK's own, field for field.

`serverInfo` reports the Graft release instead of `0.0.0`.

Token messages speak to whoever holds the token. A revoked or unknown Studio token is told to get a live one from Developer, Agents, not to configure `createActorResolver`. A token missing a scope is told which access level carries it. An anonymous caller is told where tokens come from.

`graft serve` beyond loopback no longer warns that MCP will refuse every caller: tokens made in Studio always work. It now says how callers get in.

On `graft studio`, the Agents page no longer shows an MCP endpoint on this computer, which answered 404. It shows `npx graft mcp` for an agent on this machine, and `/api/mcp` wherever `graft serve` runs.
