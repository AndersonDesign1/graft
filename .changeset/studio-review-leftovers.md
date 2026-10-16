---
"@usegraft/studio": patch
"@usegraft/mcp": patch
"@usegraft/cli": patch
---

Studio's Publish button no longer says "Publish" for a moment before it says Commit or Submit for review. It now reads what it does from the workspace, which answers at once, instead of guessing until the drafts load.

A collection's search, filters and sort are kept in the address, so a reload, the back button or a shared link shows the same rows. Its count, and Home's, no longer include entries deleted in a draft: they stay listed as Deleted until the deletion is published.

Home's recent activity folds a run of the same person changing the same entries into one row ("Kyrus, 3 times"). Health and Settings read the content again after every save, publish, discard or delete, so their counts are never from before the last change. Studio has a favicon, so browsers stop asking the server for `/favicon.ico`.

An agent's `publish_drafts` that commits to the production branch on GitHub now calls the site's deploy hooks under `graft serve`, as a database publish does. `createGraftMcp` takes an `onPublished` callback for this. A hook that fails never fails the publish.
