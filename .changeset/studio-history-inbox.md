---
"@usegraft/db": minor
"@usegraft/compiler": minor
"@usegraft/studio": minor
---

Studio keeps each entry's history, puts every decision in one inbox, and
shows what was published lately.

- **History.** The entry's panel has a History tab. It lists every published
  version with who made it and when. Open one to see how the entry differs
  from it now, then restore it as a draft. History comes from the published
  revisions when content is in the database, the production branch's commits
  on GitHub, and the checkout's commits locally. New API routes:
  `GET /entry/history` and `GET /entry/version`.
- **Inbox.** Changes sent for review and agents asking before a destructive
  call share one inbox, with a count in the sidebar. When content is in the
  database, someone who can publish publishes a review from there. Approvals
  move out of the Developer views, and old `#/dev/approvals` links open the
  inbox.
- **Home.** A "Recently published" feed lists who published what, with
  links to the entries (`GET /activity`).
- Content stores gain optional `history`, `readVersion` and `activity`
  methods. `DatabaseStore` and `GitHubStore` implement them, and
  `@usegraft/db` adds `publishedHistory`, `recentlyPublished` and
  `readPublishedRevision`.
