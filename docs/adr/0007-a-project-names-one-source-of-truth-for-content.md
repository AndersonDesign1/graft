# 0007 — A project names one source of truth for its content: git or the database

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

Graft's first invariant was "git is authoritative for authored content". It
kept the system simple to reason about: the index is derived, and when it
disagrees with the files, the files win and compile rebuilds.

It also put git in front of every editor. A hosted Studio saves through the
GitHub API and publishes by moving a branch. Setting that up takes a GitHub
App or token, an OAuth app, a session secret, an editor list and a second
long-running server. That is about eleven variables. Every publish then waits
for the host to rebuild. For a team of developers that is a fair price. For a
site run by someone who has never opened a terminal, it is the reason they
would pick another CMS.

Studio already needs Postgres for its developer views and approvals, so the
cheaper path was always available: keep the content in the database it already
has, and publish by updating the index the site reads.

The obvious way to add that is a blend: Studio writes to Postgres, developers
write to git, and something reconciles them. A database in front of git that
can hold edits git has not seen is a second source of truth, whatever it is
called. When the sync between them drops an event, one side drifts, and the
usual repair (rebuild the database from git) throws away whatever had not been
pushed.

## Decision

`graft.config.ts` exports `content = { source: "git" | "database" }`, defaulting
to `git`. A project has exactly one source, and every surface reads it.

- **`git`** is unchanged. The files are authoritative, the index is derived,
  and compile reads the content directory.
- **`database`** makes Postgres authoritative. A save is a draft revision in
  `content_revisions`. Publishing validates the drafts with the same checks a
  compile makes (`validateDocuments`), then makes them the live revisions and
  updates the index in one transaction, so the site serves the change without a
  rebuild. Compile reads the published revisions and never the files. The files
  are a checkout. `graft content import` loads them into the database, and
  later work adds `graft pull` and `graft push` to move between the two.

The store decides, not each caller. `DatabaseStore` implements the existing
`ContentStore` interface beside the filesystem and GitHub stores, and Studio,
MCP and the CLI mount it when the project is database-sourced. Operations that
only make sense on files refuse with `CONTENT_SOURCE_MISMATCH` instead of
acting on a stale checkout: reverting to a commit, merging a branch's files,
and content migrations.

There is one draft per document, shared by everyone, and each revision records
who wrote it, person or agent. Saves by one person within ten minutes update
their draft in place, so history shows sittings rather than keystrokes. Every
write locks the document's head row first, so the version check and the write
are one compare-and-swap. Two tabs, two people, or an agent and a person saving
one document are serialised, and the loser gets `CONTENT_CONFLICT`.

## Premise

- Nothing treats both sources as authoritative at once. A database-sourced
  project's compile never reads files, and a git-sourced project never writes
  revisions. If a feature needs to read both and pick a winner, this decision
  has been broken and needs a new ADR.
- A database revision passes every check a file does before it can go live:
  the schema, slug uniqueness and MDX safety (ADR 0006). If a publish path ever
  skips `validateDocuments`, the database source accepts content that git
  would refuse.
- The MDX bytes are stored as written, so moving between sources is lossless.

## Consequences

- The pitch changes from "MDX in git" to "MDX in git, or in your Postgres".
  That is less pure, and it lets a team that will never use git run Graft.
- Some features will exist only in database mode, because they are rows there
  and awkward in git: history and restore, scheduling, trash. The docs have to
  say which mode a feature needs.
- A database-sourced project's content is only as safe as its database. The
  runtime role can now write revisions, with the same honest cost
  `content_index` already carried (see `runtimeRoleGrantsSql`). Revisions are
  never deleted, so an overwrite is recoverable from history.
- The invariant in CONVENTIONS.md and CONTRIBUTING.md now reads "one source of
  truth per project". A change that blends the two is still turned down.
