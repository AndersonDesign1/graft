---
"@usegraft/contracts": patch
"@usegraft/core": patch
"@usegraft/mcp": patch
"@usegraft/registry": patch
---

These packages now need zod 4.6.7 or newer. Earlier 4.x releases can run out of memory while validating a very large array or set that has a size limit.
