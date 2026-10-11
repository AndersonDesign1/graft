---
"@usegraft/compiler": patch
---

Paths inside the content directory now refuse a dangling symbolic link. The check followed the link, so a link whose target did not exist read as absent, and a Studio or MCP write then created the target outside the content directory. A delete on a read-only filesystem now fails with `CONTENT_TREE_READ_ONLY`, the same error a save gives, instead of a raw `EROFS`.
