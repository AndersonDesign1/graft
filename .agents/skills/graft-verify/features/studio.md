# Studio

An editor opens Studio, sees the content and what is not committed yet, and
edits a page.

## Sub-features

- `studio.home`: the home screen lists collections and uncommitted drafts.
- `studio.tree`: `GET /api/studio/v1/tree` returns collections and documents.
- `studio.openapi`: `GET /api/studio/v1/openapi.json`.
- `studio.edit`: editing a document saves a draft; Commit makes a local Git
  commit in the project's checkout. It never pushes.

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

## Gotchas

- Studio needs Postgres. In a static project it exits with
  `ENV_VAR_MISSING: DATABASE_URL is not set`.
- Studio is unauthenticated on loopback by design. Off loopback it needs
  scopes, so a remote check needs a token.
- Stop it with `kill $STUDIO_PID`, then `pg.sh down "$P/pg"`.
