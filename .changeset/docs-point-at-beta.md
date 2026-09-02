---
"@usegraft/cli": patch
---

Point the getting-started install at `@beta`, because the docs already describe it.

`latest` is `0.2.0` and these docs are written against `1.0.0-beta.x`. That gap
is not cosmetic: `approvalPolicy` moved out of `GRAFT_APPROVAL_POLICY` and into
`graft.config.ts`, so someone following the page on a default install configures
a policy their build ignores. The relative-endpoint fix and the database leaving
the browser dependency graph are also beta-only.

Every install command on the page now carries `@beta`, with a note saying it is
a channel rather than a snapshot — subscribe once, upgrade normally, drop the
tag when 1.0 ships.
