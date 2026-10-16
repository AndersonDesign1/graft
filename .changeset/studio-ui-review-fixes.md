---
"@usegraft/studio": patch
---

Studio fixes from a review of the last release's UI work.

- **The editor's menus and inline code look like Studio again.** Since the editor started loading on demand, Milkdown's stylesheet arrived after Studio's and won ties: the slash menu had no background or shadow, and inline code lost its font and fill. It now sits in a cascade layer under Studio's own styles.
- **The publish sheet no longer re-renders without end while drafts load.** On a slow GitHub workspace it spun until the drafts answered, and forever if they never did. It shows a placeholder, or the error with Try again, and names the action from the workspace as the top bar does.
- **A failed workspace request shows the error and Try again** in Agents, Branches, History, Media and the Inbox, instead of a placeholder that never ends.
- **Deleting several entries goes past one that is refused,** says how many were deleted, keeps the refused ones selected, and refreshes the list either way.
- **A bulk edit cut off partway refreshes the list** and says some entries may have been saved.
- **If the editor's code fails to load, only the editor says so,** with Reload, and the entry's fields keep working.
- **Keyboard:** j and k no longer move focus behind a confirm dialog. Arrow keys from a row's checkbox move from that row, not from the first.
- **Words:**
  - Errors read as two plain sentences, with no em dash.
  - The "add a database" steps include removing `index = "static"`.
  - Health shows no drift columns when there is no index.
  - Media doesn't offer uploads without a database.
  - Discard on entries with no drafts says there is nothing to discard.
