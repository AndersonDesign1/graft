---
"@usegraft/contracts": minor
"@usegraft/mdx-safety": minor
"@usegraft/core": minor
"@usegraft/mcp": minor
"@usegraft/cli": minor
---

Fixes found by independent review of the hardening work itself.

- **The rate-limit peer is no longer a header.** `x-graft-peer` was stripped and
  re-set by Graft's Node adapter, which is sound for `graft serve` and worthless
  in a Next.js or Astro route that passes the browser's Request through
  untouched — a client could send the header and choose its own bucket. That is
  the `x-forwarded-for` bug, relocated to a header nobody knew they had to
  strip. The peer is now registered against the Request object in-process
  (`setRequestPeer` / `getRequestPeer`), which nothing over the wire can forge.
  `PEER_HEADER` is removed. Deployments with no adapter share one `unknown`
  bucket unless they declare `trustedProxyHops`; both examples now do.
- **`@usegraft/mdx-safety` parses what the renderer parses, and fails closed.**
  The checker used `remark-parse` + `remark-mdx` while `MdxBody` compiles with
  `remark-gfm` — so source that failed to parse here but compiled there was
  waved through by the old "unparseable means nothing to execute" shortcut. GFM
  is now enabled on both sides, and unparseable source throws
  `UncheckableMdxError` instead of returning `[]`.
- **Scripting elements and inline event handlers are refused.**
  `<script>alert(1)</script>` and `<img onerror="…">` contain no `{}`
  expression, so the expression checks never saw them. The module now documents
  that it is not a general HTML sanitiser.
- **`createGraftMcp` fails closed when `actor` is set without `connectionActor`.**
  That combination silently disabled every MCP write-tool scope check, and it
  shipped in one of our own example scripts.
