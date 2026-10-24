---
"@usegraft/cli": minor
---

`graft` now tells you when a newer Graft is on npm. After a command finishes, it prints the new version, the version you have, and a link to the upgrade guide on stderr. On a beta the notice is yellow, because beta releases often include security fixes. On a stable release it is cyan.

The CLI asks the registry at most once a day and caches the answer under `~/.cache/graft` (or `XDG_CACHE_HOME`). It never fails a command, and waits at most 1.5 seconds for the registry. The check is off under `CI`, for `graft mcp`, and when `GRAFT_NO_UPDATE_CHECK=1` is set. `NO_COLOR` turns the color off.
