---
"@usegraft/studio": patch
---

`@usegraft/studio` also exports `ContentChangeNotice` and `ReviewRequest`, the two types its editor DTOs refer to, so typing a response needs one import instead of a second one from `@usegraft/compiler`.
