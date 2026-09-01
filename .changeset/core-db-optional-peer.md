---
"@usegraft/core": minor
"@usegraft/sdk-react": patch
"@usegraft/sdk-core": patch
---

**BREAKING:** `@usegraft/db` is an optional peer dependency of
`@usegraft/core` rather than a dependency.

`db-out-of-the-browser` moved the database off sdk-core's direct dependencies,
but only half the graph went with it. `@usegraft/core` stayed a hard dependency
of sdk-core and kept its own hard dependency on `@usegraft/db`, so the chain
survived one hop further out:

    sdk-react -> sdk-core -> core -> db -> postgres, drizzle-orm

Bundling was already safe, because sdk-core imports core with `import type` and
those erase. The install was not: `npm i @usegraft/sdk-react` still downloaded
`postgres` and `drizzle-orm`, which is the exact complaint that fix opens with.
cubic kept the thread open on the pull request and was right to.

`npm i @usegraft/sdk-react` now pulls one external package, `zod`.

Every package that reaches core's database-backed modules at runtime already
declares `@usegraft/db` directly (`cli`, `compiler`, `mcp`, `studio`, and the
five server adapters), so nothing needs a new dependency. The packages that
depend on core without it — `auth`, `content-migrations`, `sdk-react` — import
only types. If you depend on `@usegraft/core` directly and call
`defineDataMigration`, `records`, or the functions handler, add
`@usegraft/db` to your own dependencies.
