---
"@usegraft/compiler": minor
"@usegraft/studio": patch
"@usegraft/mcp": patch
---

A delete or a slug change checks references against the files, not an index that is behind them. After a `git pull` with no compile, a Studio or MCP delete could remove a document a pulled one pointed at, and the next `graft compile` failed. It could also refuse a delete over a document already gone from the files. Ordinary saves still check against the index, which keeps them fast. `checkRemoval` from `@usegraft/compiler` reads only the files: pass `contentDir` and drop `db` and `branchId`.

Studio fixes from the review:

- Set a field opens ready to set a value. Removing a field from every selected entry is a separate checkbox, so an empty value no longer removes it on one Enter.
- The back link from an entry returns to the list as you left it: search, filters and sort.
- A filter that came from a link, on a field with no filter menu, shows as a chip you can remove. It used to narrow the list with nothing on screen saying so.
- A disabled Commit button says why on hover, on keyboard focus and to a screen reader, not only in a tooltip that never showed.
- Home folds repeated saves into one row only within an hour of each other, so Monday's edits don't vanish under Friday's.
- After a partial bulk failure, the selection keeps only rows the list still shows, so its count matches what the next action does.
- A refresh that fails says the rows on screen are from before.
- Opening a list, or Health and Settings, reads it once, not twice.
