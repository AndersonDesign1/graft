---
"@usegraft/studio": patch
---

`@usegraft/studio` exports the types of the editor API: `EntryDto` (the replacement for the removed `DocumentDto`), `EntryList`, `EntrySummary`, `SaveEntryResult`, `WorkspaceDto`, `DraftsDto`, `DraftDiffDto`, `PublishResultDto` and the types they use. Code that calls `/api/studio/v1/entry` can type its responses without copying them.
