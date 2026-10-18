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
- `studio.bulk-field`: selecting rows in a collection and choosing Set a
  field saves one field's new value on each as a draft
  (`POST /api/studio/v1/entries/field`), and lists the entries it couldn't.
- `studio.accounts`: with `GRAFT_STUDIO_SECRET` set, `graft serve --studio`
  asks for the owner account on the first visit, then signs people in with an
  email and password. Admins invite people and reset passwords from
  Settings, People.
- `studio.oidc`: with `GRAFT_OIDC_ISSUER`, `GRAFT_OIDC_CLIENT_ID` and
  `GRAFT_OIDC_CLIENT_SECRET` set, the sign-in screen offers "Continue with
  <GRAFT_OIDC_NAME>". A verified email signs in as its Studio account, or with
  the role `GRAFT_STUDIO_EDITORS` gives it; anyone else is refused.

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

- **A field set on many entries.** In `Products`, tick three rows
  (`Select <title>` checkboxes), press `Set a field` in the `Selected entries`
  toolbar, pick `Archived` in the dialog and press `Set Status on 3 products`.
  The rows read Draft and Archived, `git diff --stat` in the sandbox shows
  three one-line changes, and `compilations` gains one row with `changed 3`.
  `curl -X POST .../api/studio/v1/entries/field -H 'content-type:
  application/json' -d '{"collection":"products","slugs":["x"],"field":"price","value":-1}'`
  answers with `failed: [{ error: "DOCUMENT_NOT_FOUND" }]` or
  `SCHEMA_VALIDATION_FAILED` per entry.

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

- **Single sign-on with a real Better Auth.** In a scratch folder outside the
  repo, `npm install better-auth @better-auth/oauth-provider pg`, and run a
  Better Auth server on `http://127.0.0.1:4100` with `jwt()` and
  `oauthProvider({ loginPage, consentPage })`, against a database you create
  on the sandbox's Postgres. Register Studio with
  `auth.api.adminCreateOAuthClient` (it needs a signed-in user's `headers`),
  `redirect_uris: ["http://localhost:4997/api/studio/v1/auth/oidc/callback"]`,
  `skip_consent: true` and `application_type: "native"`: Better Auth refuses an
  http loopback redirect from a web client. Use `localhost` for Studio and
  `127.0.0.1` for the provider, so their cookies don't mix. Start `serve
  --studio --host localhost --port 4997` with the three `GRAFT_OIDC_*`
  variables, the issuer `http://127.0.0.1:4100/api/auth`. In a browser, sign in
  at the provider (`POST /api/auth/sign-in/email`), open
  `http://localhost:4997/studio/`, and press the button. Someone with a Studio
  account lands as `via: "account"`, someone on `GRAFT_STUDIO_EDITORS` as
  `via: "oidc"`. An unverified email lands on `?signin=email_unverified`.
  Repeat with the client registered for `client_secret_post`, and with
  `oauthProvider({ disableJwtPlugin: true })` and no `jwt()` (HS256 ID tokens,
  no `jwks_uri`).

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
