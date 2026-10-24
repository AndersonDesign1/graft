---
"@usegraft/mdx-safety": minor
"@usegraft/compiler": minor
"@usegraft/cli": minor
---

`graft check` and `graft compile` skip the executable-MDX scan for a body they have already scanned. Results are kept under `$XDG_CACHE_HOME/graft/mdx-safety` (by default `~/.cache/graft/mdx-safety`), outside the project, and are keyed on the body and on the versions of the scanner and its parsers. A repeat `graft check` on a 50-page site went from about 1.7 s to about 0.3 s.

`@usegraft/mdx-safety` adds `scanMdx`, the `MdxScanCache` interface and `mdxScanVersion`, and the compiler's `validateDocuments`, `compile` and `compileStatic` take an optional `mdxScanCache`. Studio saves and MCP writes do not pass one, so they scan every body every time.
