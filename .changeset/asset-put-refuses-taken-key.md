---
"@usegraft/cli": minor
"@usegraft/mcp": patch
---

`graft asset put` refuses a key that already holds a file, like `put_asset`.

The MCP `put_asset` tool has refused a taken key with `ASSET_EXISTS` unless the
caller passed `overwrite: true`. The CLI did not check: it replaced whatever was
stored under the key. The store keeps no version history, so the old file was
gone, and every page pointing at the key showed the new one.

The CLI now checks first and fails with the same `ASSET_EXISTS` error. Pass
`--overwrite` to replace the file on purpose.

**Breaking:** a script that re-uploads to the same key now fails until it adds
`--overwrite` or picks a new key.
