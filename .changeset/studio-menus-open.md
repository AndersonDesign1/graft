---
"@usegraft/studio": patch
---

Opening the account, sort or filter menu no longer turns Studio into a blank
page. Each menu put its label outside a group, which the menu library refuses,
and nothing caught the error. Menu labels now always come with their group,
menu items sit on one line, and a rendering error shows what went wrong with a
Reload button instead of a white page.
