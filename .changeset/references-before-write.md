---
"@usegraft/compiler": minor
"@usegraft/db": minor
"@usegraft/studio": patch
"@usegraft/mcp": patch
---

References are checked before a write, not after it. A local Studio save, bulk edit, delete or discard, and MCP's `write_content` and `delete_content`, used to write or delete the file and then check references while updating the index. A refusal said nothing was saved while the file had changed, and the index no longer matched it. Now a refused write leaves every file as it was.

- **`checkChange`** in `@usegraft/compiler` checks a change to a few files before it is written: the checks a compile makes of them, references included, and that nothing left as it is points at a document the change deletes or renames. It checks against the Postgres index, or the files when there is none.
- **A stale index no longer refuses a good save.** A reference may name a file in the content folder the index hasn't caught up with, such as one a `git pull` brought in.
- **On the static index or with none,** deletes and discards are checked too, and a reference already broken somewhere else no longer refuses an unrelated save. `graft compile` still reports it.
- **`checkRemoval` takes `contentDir`,** and checks against the files there when it is given no `db`.
- **Publishing in a database-sourced project checks references once it holds the content lock.** Two publishes at once, one deleting a category and one pointing a product at it, could each pass against the state before the other. `publishDrafts` in `@usegraft/db` accepts the index rows as a function of the live documents for this.
- **A bulk edit is checked as a batch before anything is written,** and sets a field on at most 500 entries at once. A file that fails to write partway is reported with the others, and the ones written still reach the index.
