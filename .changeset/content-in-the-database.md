---
"@usegraft/db": minor
"@usegraft/compiler": minor
"@usegraft/cli": minor
"@usegraft/mcp": minor
"@usegraft/studio": minor
"@usegraft/contracts": minor
---

Content can now live in your Postgres database instead of in git. Add
`export const content = { source: "database" }` to `graft.config.ts` and run
`graft content import` to load your files once.

Studio and agents then save drafts to the database, and publishing puts a
change on the live site straight away, with no rebuild and no GitHub setup. A
hosted Studio needs only `DATABASE_URL`. Every publish is checked exactly as
`graft compile` checks a file (the schema, slug uniqueness and MDX safety), and
a draft that would fail compile never goes live. `graft compile` reads the
published versions, never the files.

There is one draft per document, shared by everyone who edits it. Two people
or an agent saving the same document from the same version can't overwrite
each other: the second save gets `CONTENT_CONFLICT`. Someone without publish
rights submits for review instead, and the request closes once everything in
it is live.

Git stays the default and works as before. A project uses one source or the
other, never both. Reverting to a commit, `graft merge` and content migrations
work on files, so in a database-sourced project they refuse with the new
`CONTENT_SOURCE_MISMATCH`.

`graft db migrate` adds three tables (`content_revisions`, `content_heads`,
`content_reviews`), and `graft harden` grants the runtime role access to them.

For code that reads review requests from a content store: `ReviewRequest` now
has an `id`, and its `number` and `url` are optional, since a review in the
database is not a pull request. The `review` that MCP `list_drafts` and
`publish_drafts` return follows the same shape.
