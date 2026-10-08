---
"@usegraft/cli": minor
---

Add `graft compile --json`. It prints one JSON object on stdout and nothing
else: `{ "branch", "gitSha", "changes" }`, where `changes` is the compile's
ChangeSet. The summary line and any other log output go to stderr. It works on
the static and Postgres engines.

Until now the only ways to get a ChangeSet were an agent's `write_content`
result or calling `compile()` from `@usegraft/compiler`. The new output is the
body a revalidate route reads, so a deploy script can pipe it on:

```sh
graft compile --json | curl --fail-with-body -X POST -H "Authorization: Bearer $GRAFT_WEBHOOK_SECRET" -H "content-type: application/json" --data-binary @- https://example.com/api/revalidate
```

`--fail-with-body` makes curl exit non-zero on an error response while still
printing its message and fix. It needs curl 7.76.0 or newer. On an older curl,
use `--fail`, which fails the same way but drops the body.

postgres-js prints server notices with `console.log`, so while a `--json`
compile runs, `console.log` is routed to stderr. Nothing a dependency logs can
corrupt the JSON.
