---
"@usegraft/studio": patch
---

A hosted Studio's change diff keeps its memory bounded. It kept a copy of the whole search frontier for every changed line, so a large rewrite (two 10,000-line versions with nothing in common) needed gigabytes and could take the server down. It now skips the unchanged start and end, keeps only the part of the frontier each step uses, and past 2,000 changed lines falls back to every old line removed and every new line added. As before, the drawer renders at most 600 lines and marks a longer diff as truncated. A hunk whose old or new side is empty now starts at the line before it, as git does (`-0,0` for a new file).
