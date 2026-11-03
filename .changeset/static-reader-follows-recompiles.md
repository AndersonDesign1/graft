---
"@usegraft/db": patch
---

A reader from `openStaticIndex` now sees each recompile. A compile replaces
the index file rather than writing into it, and an open reader kept reading
the file it opened, so a dev server showed the content from when it started
until it restarted. Each read now checks whether the file was replaced and
reopens it if so.
