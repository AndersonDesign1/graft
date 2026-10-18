---
"@usegraft/mcp": patch
---

Requires `@modelcontextprotocol/sdk` 1.31 or newer. Older versions could send an OAuth client's credentials to the wrong authorization server, and pulled in `proxy-addr`, `hono` and `ip-address` versions with known advisories.
