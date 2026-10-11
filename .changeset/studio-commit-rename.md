---
"@usegraft/studio": patch
---

Committing a staged rename from Studio works: the old path is recorded as removed instead of passed to `git add`, which refused it because the file is gone.
