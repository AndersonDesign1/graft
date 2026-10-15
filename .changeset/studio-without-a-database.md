---
"@usegraft/studio": minor
"@usegraft/cli": minor
---

`graft studio` starts without a database. Until now it stopped with
`ENV_VAR_MISSING: DATABASE_URL is not set`, so a static project (`export const
index = "static"`) could not use Studio at all, and a Postgres project could
not open it to fix a typo without a running database.

Without `DATABASE_URL` you can find, edit, create, delete and commit content as
before. In a static project each save also updates `.graft/index.db`, and
Developer, Health compares the files with it; a static project never uses a
database even when one is set, as with `graft mcp`. The views whose data lives
in Postgres (approvals, the compile history, branches, people, agents, the
media library, site settings) say they need a database and how to add one,
and their API routes answer `NEEDS_DATABASE` (HTTP 503) with the same steps.

For `createStudioHandler`, `db` is now optional, and `staticIndexPath` points a
Studio at the static index:

```ts
createStudioHandler({ collections, contentDir, staticIndexPath: ".graft/index.db" });
```

`GET /workspace` reports `database` and `index` (`"postgres"`, `"static"` or
`"none"`), and `GET /tree` reports which index its states are measured
against.

Sign-in is unchanged. A `graft studio` on `127.0.0.1` asks nobody to sign in,
with or without a database. Studio accounts and their sessions are kept in
Postgres, so they still need one, and `graft serve --studio` still requires
`DATABASE_URL`.
