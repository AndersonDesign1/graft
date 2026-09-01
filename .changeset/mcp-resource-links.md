---
"@usegraft/mcp": patch
---

Return `resource_link` blocks from the content tools, so an answer that names
documents also says where they are.

`list_content`, `get_content`, `search_content` and `write_content` now carry a
link per document alongside their text. A tool answering "here are eleven
documents" and leaving the client to reconstruct eleven URIs was asking it to
know the scheme; a search hit already knows its collection and slug, so the
link saves a `get_content` round trip to reach the document itself.

The URI scheme lives in one module now, used by both the links and the resource
registration. Two spellings of it would be two things to keep in step, and the
failure would be silent — a link pointing at a URI nothing serves reads as a
broken client rather than a server that disagrees with itself. The test follows
a link through `readResource` rather than comparing strings.

The text block stays first, so a client that ignores links loses nothing, and
a failure emits no links at all.
