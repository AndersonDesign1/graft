---
"@usegraft/mcp": patch
---

`run_function` now sets `openWorldHint: true`. It runs the project's own
functions, and a function can call any external service, so it cannot promise
the closed world every other tool does. Every other tool keeps
`openWorldHint: false`.
