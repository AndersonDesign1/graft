---
"@usegraft/sdk-react": patch
---

`useContentSearch` and `graft.searchContent` now treat an empty or
whitespace-only query as a search with no results. They return `[]` without
sending a request, so a search box that starts empty no longer shows an error
before anyone types.
