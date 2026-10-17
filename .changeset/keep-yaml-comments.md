---
"@usegraft/compiler": patch
---

A save keeps the comment after an edited value. Changing `title: "Old" # shown in the tab` in Studio or over MCP used to write `title: "New"` and lose the note; it now writes `title: "New" # shown in the tab`. This holds for quoted and plain one-line values. A value that becomes a list or a map drops the comment, because it no longer has one line to sit on.
