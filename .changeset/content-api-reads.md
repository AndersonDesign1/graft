---
"@usegraft/content-api": patch
"@usegraft/cli": patch
"@usegraft/mcp": patch
---

Add a versioned, read-only authored-content HTTP API and a remote
`ContentIndexReader`. `graft serve` now mounts document reads and search at
`/api/content/v1`, fixed to the server's resolved branch.
