# Studio

An editor opens Studio, sees the content and what is not committed yet, and
edits a page.

## Sub-features

- `studio.home`: the home screen lists collections and uncommitted drafts.
- `studio.tree`: `GET /api/studio/v1/tree` returns collections and documents.
- `studio.openapi`: `GET /api/studio/v1/openapi.json`.
- `studio.edit`: editing a document saves a draft; Commit makes a local Git
  commit in the project's checkout. It never pushes.
- `studio.database`: with `content = { source: "database" }`, saves are draft
  revisions in Postgres and Publish puts them live with no rebuild. Nothing is
  written to `content/`.
- `studio.accounts`: with `GRAFT_STUDIO_SECRET` set, `graft serve --studio`
  asks for the owner account on the first visit, then signs people in with an
  email and password. Admins invite people and reset passwords from
  Settings, People.

## How to get to it (user POV)

- `graft studio` in a Postgres project, then the printed URL.
- `graft serve --studio`, mounted at `/studio`.

## Driving it with agent-browser and curl

Preconditions: a Postgres sandbox (`sandbox.sh --postgres`), `cd "$P"`, then
`$O node $REPO/packages/cli/dist/index.js studio --port 4999 &` and
`STUDIO_PID=$!` (`offline.sh` execs, so this is Studio's own PID). When the
environment already sets `DATABASE_URL`, Studio without `$O` connects to that
database instead of the sandbox's. Ready when the log prints `graft studio — branch "main"`.

- **The tree is served.** `curl -s http://127.0.0.1:4999/api/studio/v1/tree`
  contains `"slug":"home"` and `"state":"synced"`.
- **Home renders.** `agent-browser open http://127.0.0.1:4999/` redirects to
  `/?branch=main`. `agent-browser snapshot -i -c` shows the `Pages` link,
  `New page`, and the `Commit` button. Screenshot it.
- **An edit becomes a draft.** Not scripted yet. Open `Pages`, then `home`,
  change the title, save, and confirm the home screen lists it under
  "Not committed yet". Add the exact handles here the first time you run it.

- **The database source publishes live.** Append
  `export const content = { source: "database" };` to `graft.config.ts`, run
  `URL=$(cat "$P/pg/url")`, then `$O --db "$URL" node $REPO/packages/cli/dist/index.js content import`, then
  start Studio. `curl -s http://127.0.0.1:4999/api/studio/v1/workspace` says
  `"storage":"database"`. In the browser: `New page` (dialog: `Title`, then
  `Create page`), edit a field, top-bar `Publish`, then the sheet's `Publish`.
  The sheet says "They're live on the site now.", and
  `select slug from content_index where not deleted` lists the new page while
  `content/` is unchanged.

- **Accounts sign people in.** In a Postgres sandbox, add
  `GRAFT_STUDIO_SECRET=$(openssl rand -base64 48)` to `.env`, then start
  `$O --db "$(cat "$P/pg/url")" env GRAFT_STUDIO_SECRET=... node
  $REPO/packages/cli/dist/index.js serve --studio --host 0.0.0.0 --port 4997 &`
  and keep its PID in a file. The banner ends with `create the owner with
  setup code XXXXX-XXXXX`; `graft studio setup-code` prints the same code.
  Open `http://127.0.0.1:4997/studio/`: the form is "Create the owner
  account" (`Your name`, `Email`, `Password`, `Setup code`, `Create account`).
  In Settings, People, invite someone; the link shows once under the form.
  Open it with `agent-browser --session other open "$LINK"`: "Join this
  Studio" (`Your name`, `Choose a password`, `Join`). `select email, role from
  studio_users` lists both.

- **Saves stay fast at scale.** `pnpm bench` in `examples/shop` (after a
  build) seeds 2,000 products in a temporary copy, starts its own Postgres
  and Studio, and prints a table of medians. `--count` and `--runs` change
  the size and the sample.

## Gotchas

- Studio runs without Postgres. In a static sandbox (`sandbox.sh` with no
  flag), `$O node $REPO/packages/cli/dist/index.js studio --port 4998` prints
  `No database: saves update .graft/index.db`, `/workspace` says
  `"database":false,"index":"static"`, and `/approvals` answers 503
  `NEEDS_DATABASE`. A save updates `content/` and `.graft/index.db`; read the
  artifact back with `openStaticIndex` from `@usegraft/db`.
- Studio is unauthenticated on loopback by design. Off loopback it needs
  scopes, so a remote check needs a token.
- Stop it with `kill $STUDIO_PID`, then `pg.sh down "$P/pg"`.
- Never stop a server with `pkill -f` on its command line: the shell running
  that command matches too, and gets killed. Kill the PID you saved.
- Account tests and `studio_users` rows are per database, not per branch, so
  the integration suites create and drop a throwaway database for them.
- Switching a sandbox to the database source without `content import` makes
  the next compile remove every page: compile reads the revisions, and there
  are none yet. That is correct behavior, not a bug.
