---
"@usegraft/studio": minor
"@usegraft/tokens": minor
---

Studio's frame and popups now match the docs. A 56px top bar runs across the
page with the `graft. / Studio` wordmark and the branch on the left, search
centred, and Commit (or Publish) and the account menu on the right. The
sidebar sits under it on the page colour. Below 768px the sidebar opens from a
menu button.

Popups share one material: the elevated surface and a 10px radius, opening in
160ms and closing in 100ms. Dialogs and sheets add a dimmed backdrop with no
blur and a visible close button; the command palette opens instantly and closes
on Escape or a choice. Deleting or discarding asks in a confirm dialog that starts on
Cancel and names the action ("Delete post") in place of the browser's
`confirm()`. The command palette shows its keys, menus carry icons, toasts
come one at a time, and committing ends with a plain check instead of an
animation.

`@usegraft/tokens` adds `--scrim`, the colour behind a dialog or sheet.
