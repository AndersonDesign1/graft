---
"@usegraft/studio": patch
---

An agent's request in the Inbox is titled with what it would do, such as "Delete projects/welup-digital", instead of the tool's name, and Approve asks once more before the agent may run it. The embedded `ApprovalQueuePanel` brings its own confirmation dialog.

Deploy hooks are now called after Studio publishes to the production branch on GitHub, as they already were after a publish of content kept in the database. A commit on your own machine reaches no site and still calls none, and Settings now says so.

Wording that didn't match what happens:

- Deleting on your own machine says the file is removed now and the deployed site keeps it until you commit and push, instead of "stays live until you commit".
- An entry nobody has edited since its last commit is dated by that commit, not by its file's modification time, which a clone or checkout resets.
- The empty Drafts tab says there are no drafts instead of "Nothing matches."
- Shortcuts in Settings and tooltips show Ctrl off a Mac, as the top bar already did.
- The entry's details no longer show a "Version" that was the file's content hash.
- An asset field's placeholder and an asset key error no longer name the shop example, and a missing key says it is missing instead of `"null" is not an asset key.`
