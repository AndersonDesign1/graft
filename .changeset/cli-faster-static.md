---
"@usegraft/db": minor
"@usegraft/core": patch
"@usegraft/compiler": patch
"@usegraft/mcp": patch
"@usegraft/cli": patch
---

Static projects no longer load the Postgres code. `@usegraft/db/static` is a new entry with the SQLite content index, the content diff, the search query check and branch scopes, and no drizzle-orm or Postgres driver behind it. Core, the compiler and the MCP server load the rest of `@usegraft/db` only inside the functions that talk to Postgres. On a 50-page static site, `graft content get` went from about 950 ms to about 480 ms. Everything in `@usegraft/db/static` is still exported from `@usegraft/db`.
