---
"@usegraft/studio": patch
---

Studio fixes from review:

- Discarding a local file that was staged as new and then deleted works, including in a repository with no commits yet. It used to try to restore it from HEAD, where it never was.
- Local drafts report each changed file's version, as GitHub drafts do. Only a deletion has none.
- A failed GitHub sign-in returns to the page the person started from, branch and hash kept, instead of Studio's front page. That needs the sign-in's own state cookie: a callback without a valid one still lands on the front page.
- Slugs drop every combining mark, not only those in U+0300 to U+036F, so a title with one no longer gains a hyphen mid-word.
- "News", "series", "species", "media" and "data" keep their form in the singular ("New news" became "New new").
- `ContentTreePanel` follows a change to its `branch` prop. It kept showing the first branch.
- The first render after a view starts loading shows the loading state, not an empty page.
- The vermilion scale uses the same lightness steps as the other hues, so unpublished-state colour reads at the same brightness.
- `WorkspaceDto.sessions` is documented as what it is: whether the request carried a session cookie.
