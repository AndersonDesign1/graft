---
"@usegraft/studio": patch
---

Lists can be walked from the keyboard. In a collection, j and k move through the entries from anywhere on the page (not while typing), and the arrow keys, Home and End once focus is in the list; Enter opens one. The list beside an open entry takes j and k too.

Forms fit what they hold:

- A string field that holds an address or a path (`url`, `githubUrl`, `thumbnail`, `email` and the like, or one with an `^https?` pattern) is a one-line input even when its limit is long. A URL allowed 2,048 characters used to open as a tall textarea.
- The create dialog asks for the title first, then the rest in the schema's order.
- A required group whose fields are all optional starts empty in the create dialog, so it no longer blocks creating an entry with "Links is required." until one of its optional fields is filled.

On a phone, an entry's bar shows whether the save landed, and drops its own Commit button (the top bar's commits this entry with the rest) and the title, which the heading below shows in full.
