---
"@usegraft/sdk-react": patch
---

`useContentSearch` and `graft.searchContent` now treat an empty or
whitespace-only query as a search with no results. They return `[]` without
sending a request, so a search box that starts empty no longer shows an error
before anyone types.

All three hooks also stop showing the previous answer for one render when
their arguments change. `useContent` with a new slug, or `useContentSearch`
with a new query, now reports loading in that same render instead of briefly
rendering the old document or hits.
