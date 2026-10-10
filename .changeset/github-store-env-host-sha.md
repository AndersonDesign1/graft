---
"@usegraft/compiler": patch
---

`GITHUB_STORE_ENV` now lists the host commit variables the store reads (`VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `RAILWAY_GIT_COMMIT_SHA`, `COMMIT_REF`, `GITHUB_SHA`), exported on their own as `DEPLOYED_SHA_ENV`. A server that allowlisted its environment from the old list dropped them, so Studio could not tell which commit was deployed.
