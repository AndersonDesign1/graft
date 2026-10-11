---
"@usegraft/studio": minor
"@usegraft/tokens": minor
---

Studio's frame and popups now match the docs. A 56px top bar runs across the
page with the `graft. / Studio` wordmark and the branch on the left, search
centred, and Commit (or Publish) and the account menu on the right. The
sidebar sits under it on the page colour. Below 768px the sidebar opens from a
menu button.

Every popup follows one set of rules: the elevated surface, a 10px radius, a
dimmed backdrop with no blur, a visible close button, and open in 160ms and
close in 100ms. Deleting or discarding asks in a confirm dialog that starts on
Cancel and names the action ("Delete post") in place of the browser's
`confirm()`. The command palette shows its keys, menus carry icons, toasts
come one at a time, and committing ends with a plain check instead of an
animation.

`@usegraft/tokens` adds `--scrim`, the colour behind a dialog or sheet.
