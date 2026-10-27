---
"@usegraft/cli": minor
---

`graft api --paginate --slurp` prints every page as one JSON array once the last one arrives. `graft api -X DELETE` now asks before it sends anything when run on a terminal; with `--no-input`, or with no terminal, it still needs `--yes`. `graft help auth` explains `graft login`, saved tokens, `--remote`, `GRAFT_URL` and `GRAFT_TOKEN`.
