---
"@usegraft/mcp": patch
---

An agent's `write_content` and `delete_content` now update the index for the
file they wrote, instead of recompiling the whole content tree, as a Studio
save does. On a 2,000-product catalog a `write_content` call took about 1.5
seconds and now takes about 110 milliseconds. The result's `changes` lists
that one document. The static index is still rebuilt whole, and content kept
in the database is unchanged.
