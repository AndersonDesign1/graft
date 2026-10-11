---
"@usegraft/mcp": minor
"@usegraft/cli": minor
---

MCP writes through the content store. On a `graft serve` that writes to GitHub (`GRAFT_GITHUB_REPO` set), `write_content` and `delete_content` commit to the connection's own draft branch instead of the read-only files, and three tools appear: `list_drafts`, `publish_drafts` (a pull request, or a commit to the production branch with the new `content:publish` scope) and `discard_drafts`. Agents and Studio editors share one draft model.
