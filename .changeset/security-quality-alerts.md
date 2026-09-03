---
"@usegraft/assets": patch
"@usegraft/cli": patch
"@usegraft/studio": patch
---

Clear leftover CodeQL findings: no ReDoS regex on storage URLs, no exception text on `/healthz` or Studio asset-url failures, and `graft studio` only opens a validated loopback URL.
