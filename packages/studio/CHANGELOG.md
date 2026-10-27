# @usegraft/studio

## 1.0.0-beta.9

### Patch Changes

- Updated dependencies [9a17a95]
- Updated dependencies [42213aa]
- Updated dependencies [acb4a84]
- Updated dependencies [42213aa]
- Updated dependencies [3374aab]
  - @usegraft/contracts@1.0.0-beta.9
  - @usegraft/db@1.0.0-beta.9
  - @usegraft/core@1.0.0-beta.9
  - @usegraft/compiler@1.0.0-beta.9
  - @usegraft/mdx-safety@1.0.0-beta.9
  - @usegraft/assets@1.0.0-beta.9

## 1.0.0-beta.8

### Minor Changes

- 70321c7: **BREAKING:** frontmatter is read as YAML or JSON only. gray-matter runs a `---js` frontmatter block through `eval`, so a contributor's Studio save, an agent's `write_content`, or a pull request built by `graft compile` could run code on the machine reading it. Every read now goes through `readFrontmatter` from the new `@usegraft/mdx-safety/frontmatter` entry, which refuses any other language with `INPUT_VALIDATION_FAILED` before parsing, whatever `mdxTrust` is. A lint rule stops gray-matter being imported anywhere else.

  **BREAKING:** `POST /api/studio/v1/changes/commit` and `POST /api/studio/v1/compilations/:id/revert` need `studio:publish`. They asked for `studio:write`, so a contributor could commit to the checkout, or roll it back, around the check Studio's Commit button makes.

  Also fixed:

  - `graft studio` with `GRAFT_DEV_TOKEN` gives the operator every admin scope, as its documentation says. Since contributors were stopped from committing locally, the token's missing `studio:publish` stopped the operator committing too.
  - Without a database, a media upload or delete is refused before the bucket is touched. Both used to change the bucket, then answer `NEEDS_DATABASE`.

- d854102: `GRAFT_STUDIO_AUTO_JOIN` lets a whole email domain join a hosted Studio without invitations: `GRAFT_STUDIO_AUTO_JOIN="shop.example.com=contributor"`. The first time someone signs in with GitHub, Google or single sign-on and has a verified email at the domain, Studio makes them an account with the domain's role (contributor by default), shown in Settings, People, where an admin can change or remove it. Someone removed stays out. Admin is never given this way, free mail providers such as gmail.com are refused, and nobody joins before the owner exists. People lists the domains that join on their own.
- ef9af08: A hosted Studio can sign people in with Google, and with any other OpenID Connect provider: Okta, Entra ID, Keycloak, your app's own Better Auth (with `@better-auth/oauth-provider`) and others. Set `GRAFT_GOOGLE_CLIENT_ID` and `GRAFT_GOOGLE_CLIENT_SECRET` for "Continue with Google", or `GRAFT_OIDC_ISSUER`, `GRAFT_OIDC_CLIENT_ID` and `GRAFT_OIDC_CLIENT_SECRET` (and `GRAFT_OIDC_NAME` for the button) for another provider. Studio runs the authorization code flow with PKCE and checks the ID token's signature, issuer, audience, expiry and nonce, and only a verified email counts.

  Settings, People is now the one place to add someone, however they sign in. A person invited there signs in with GitHub, Google or single sign-on as their Studio account, and their first sign-in uses the invitation: no link to pass on, no password to choose. GitHub matches any verified address on the person's account. Someone signed in as an account with no password sees no password to change in Settings.

- 6161f0e: Set one field on many entries at once. Select entries in a collection's list
  and choose **Set a field**: pick the field and its value with the same
  control the entry editor uses, and Studio saves each entry as a draft.
  Nothing goes live until it is published. Entries that can't be saved are
  listed in the dialog with the reason and stay selected; the rest are saved.

  The API behind it is `POST /api/studio/v1/entries/field`:

  ```json
  {
    "collection": "products",
    "slugs": ["wool-hat", "linen-shirt"],
    "field": "status",
    "value": "archived"
  }
  ```

  Each entry is validated and written exactly as `PUT /entry` would, against
  the version read just before the write. `"value": null` removes an optional
  field. A local Studio updates the index once for the whole batch. The answer
  lists `saved` entries with their new versions and `failed` entries with their
  error code, message and fix.

  On a phone, the bulk bar's buttons now wrap instead of running off the screen.

- f1ed5d2: `graft studio` starts without a database. Until now it stopped with
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
  createStudioHandler({
    collections,
    contentDir,
    staticIndexPath: ".graft/index.db",
  });
  ```

  `GET /workspace` reports `database` and `index` (`"postgres"`, `"static"` or
  `"none"`), and `GET /tree` reports which index its states are measured
  against.

  Sign-in is unchanged. A `graft studio` on `127.0.0.1` asks nobody to sign in,
  with or without a database. Studio accounts and their sessions are kept in
  Postgres, so they still need one, and `graft serve --studio` still requires
  `DATABASE_URL`.

### Patch Changes

- 48e07b9: Lists can be walked from the keyboard. In a collection, j and k move through the entries from anywhere on the page (not while typing), and the arrow keys, Home and End once focus is in the list; Enter opens one. The list beside an open entry takes j and k too.

  Forms fit what they hold:

  - A string field that holds an address or a path (`url`, `githubUrl`, `thumbnail`, `email` and the like, or one with an `^https?` pattern) is a one-line input even when its limit is long. A URL allowed 2,048 characters used to open as a tall textarea.
  - The create dialog asks for the title first, then the rest in the schema's order.
  - A required group whose fields are all optional starts empty in the create dialog, so it no longer blocks creating an entry with "Links is required." until one of its optional fields is filled.

  On a phone, an entry's bar shows whether the save landed, and drops its own Commit button (the top bar's commits this entry with the rest) and the title, which the heading below shows in full.

- 8a5c753: A contributor on a local Studio can no longer commit. Locally there is no review step, so a commit landed on the checkout at once, whatever the role. The contributor's drafts now wait for an editor: the Commit buttons are off with the reason, and the API refuses with `UNAUTHORIZED` and `details.required: "studio:publish"`.

  A local commit is now authored by the signed-in person instead of whoever runs Studio, who stays the committer. With no message, it names the entries by title (`Update “Wool Hat”`) instead of by path, and the Publish sheet's placeholder shows that message.

  A refusal now speaks to whoever was refused. A person is told their role can't do it and to ask an admin. A token is told the scope it lacks and where to make one that has it. Studio shows these messages instead of "You're signed out".

- c9868b0: `tools/list` no longer fails with "Cannot read properties of undefined (reading 'push')" when the MCP SDK resolves an older zod than Graft's. The SDK takes any zod from 3.25 on, so a project whose own dependencies bring zod 4.2 to 4.4 handed the SDK a converter that crashed on Graft's schemas. Calling a tool by name still worked, but standard clients list tools first, so none of them could connect. The listing is now converted with the zod that built the schemas, and is otherwise the SDK's own, field for field.

  `serverInfo` reports the Graft release instead of `0.0.0`.

  Token messages speak to whoever holds the token. A revoked or unknown Studio token is told to get a live one from Developer, Agents, not to configure `createActorResolver`. A token missing a scope is told which access level carries it. An anonymous caller is told where tokens come from.

  `graft serve` beyond loopback no longer warns that MCP will refuse every caller: tokens made in Studio always work. It now says how callers get in.

  On `graft studio`, the Agents page no longer shows an MCP endpoint on this computer, which answered 404. It shows `npx graft mcp` for an agent on this machine, and `/api/mcp` wherever `graft serve` runs.

- 36472f3: References are checked before a write, not after it. A local Studio save, bulk edit, delete or discard, and MCP's `write_content` and `delete_content`, used to write or delete the file and then check references while updating the index. A refusal said nothing was saved while the file had changed, and the index no longer matched it. Now a refused write leaves every file as it was.

  - **`checkChange`** in `@usegraft/compiler` checks a change to a few files before it is written: the checks a compile makes of them, references included, and that nothing left as it is points at a document the change deletes or renames. It checks against the Postgres index, or the files when there is none.
  - **A stale index no longer refuses a good save.** A reference may name a file in the content folder the index hasn't caught up with, such as one a `git pull` brought in.
  - **On the static index or with none,** deletes and discards are checked too, and a reference already broken somewhere else no longer refuses an unrelated save. `graft compile` still reports it.
  - **`checkRemoval` takes `contentDir`,** and checks against the files there when it is given no `db`.
  - **Publishing in a database-sourced project checks references once it holds the content lock.** Two publishes at once, one deleting a category and one pointing a product at it, could each pass against the state before the other. `publishDrafts` in `@usegraft/db` accepts the index rows as a function of the live documents for this.
  - **A bulk edit is checked as a batch before anything is written,** and sets a field on at most 500 entries at once. A file that fails to write partway is reported with the others, and the ones written still reach the index.

- e61014f: A delete or a slug change checks references against the files, not an index that is behind them. After a `git pull` with no compile, a Studio or MCP delete could remove a document a pulled one pointed at, and the next `graft compile` failed. It could also refuse a delete over a document already gone from the files. Ordinary saves still check against the index, which keeps them fast. `checkRemoval` from `@usegraft/compiler` reads only the files: pass `contentDir` and drop `db` and `branchId`.

  Studio fixes from the review:

  - Set a field opens ready to set a value. Removing a field from every selected entry is a separate checkbox, so an empty value no longer removes it on one Enter.
  - The back link from an entry returns to the list as you left it: search, filters and sort.
  - A filter that came from a link, on a field with no filter menu, shows as a chip you can remove. It used to narrow the list with nothing on screen saying so.
  - A disabled Commit button says why on hover, on keyboard focus and to a screen reader, not only in a tooltip that never showed.
  - Home folds repeated saves into one row only within an hour of each other, so Monday's edits don't vanish under Friday's.
  - After a partial bulk failure, the selection keeps only rows the list still shows, so its count matches what the next action does.
  - A refresh that fails says the rows on screen are from before.
  - Opening a list, or Health and Settings, reads it once, not twice.

- 9d26068: Studio no longer loops silently when opened over plain http on an address other than localhost. The session cookie is `Secure` there, so the browser dropped it and sign-in landed back on the form with no message. Studio now says sign-in needs https, or localhost, instead of showing a form that can't work, and an invite link stays unused until it can sign someone in.

  `graft doctor` and `setup_status` no longer make a missing `GRAFT_STUDIO_SECRET` the next step: it only matters once the site is online. That check now has its own id, `studio-secret`. With nothing else to do, doctor says the project is ready to work on and that the `!` lines are for going online. Once the secret is set, creating the owner account is still the next step.

  `graft --help` lists `graft studio setup-code` and `graft studio invite`.

- 118a339: Studio loads its editors when an entry opens, not with the app. Milkdown and
  CodeMirror were about 2.7 MB of the 3.3 MB every Studio page downloaded
  before it could show the home screen or a list. Now the first page loads
  0.66 MB (201 kB gzipped), and opening an entry adds the editor (1.66 MB, 532
  kB gzipped); the languages a code block highlights load only when one asks
  for them. The same split applies to `@usegraft/studio/panels`, whose bundle
  goes from 4.8 MB to 0.5 MB with the editor in a chunk of its own.
- 0263253: Settings, Keyboard lists the list shortcuts: J and K move down and up a collection's entries, the arrow keys, Home and End move through a list once it has focus, and Enter opens the selected entry.
- 9571702: Studio's Publish button no longer says "Publish" for a moment before it says Commit or Submit for review. It now reads what it does from the workspace, which answers at once, instead of guessing until the drafts load.

  A collection's search, filters and sort are kept in the address, so a reload, the back button or a shared link shows the same rows. Its count, and Home's, no longer include entries deleted in a draft: they stay listed as Deleted until the deletion is published.

  Home's recent activity folds a run of the same person changing the same entries into one row ("Kyrus, 3 times"). Health and Settings read the content again after every save, publish, discard or delete, so their counts are never from before the last change. Studio has a favicon, so browsers stop asking the server for `/favicon.ico`.

  An agent's `publish_drafts` that commits to the production branch on GitHub now calls the site's deploy hooks under `graft serve`, as a database publish does. `createGraftMcp` takes an `onPublished` callback for this. A hook that fails never fails the publish.

- 41c371f: A local Studio save now updates the index for the file it wrote, instead of
  recompiling the whole content tree. On a 2,000-product catalog a save took
  1.6 seconds and now takes about 100 milliseconds.

  The save checks the file with the same rules as `graft compile` (the schema,
  MDX safety, unique slugs) and records a compilation with the commit it was
  read at, so the compile history still lists it. Other files are left as they
  are: a file changed outside Studio reaches the index on the next
  `graft compile`. One broken file elsewhere in the tree no longer makes every
  save fail.

  Two functions make this available outside Studio:

  ```ts
  import { compileDocuments } from "@usegraft/compiler";

  // Read, validate and project two files; a missing one comes off the index.
  await compileDocuments({
    contentDir,
    collections,
    db,
    paths: ["products/wool-hat.mdx"],
  });
  ```

  `projectDocuments` in `@usegraft/db` is the projection underneath, and it is
  the one a database-sourced publish already used. It changes only the rows it
  is given, refuses a slug another live file holds with `SLUG_NOT_UNIQUE`, and
  removes a row whose file no longer produces it.

- db2d4b6: An agent's request in the Inbox is titled with what it would do, such as "Delete projects/welup-digital", instead of the tool's name, and Approve asks once more before the agent may run it. The embedded `ApprovalQueuePanel` brings its own confirmation dialog.

  Deploy hooks are now called after Studio publishes to the production branch on GitHub, as they already were after a publish of content kept in the database. A commit on your own machine reaches no site and still calls none, and Settings now says so.

  Wording that didn't match what happens:

  - Deleting on your own machine says the file is removed now and the deployed site keeps it until you commit and push, instead of "stays live until you commit".
  - An entry nobody has edited since its last commit is dated by that commit, not by its file's modification time, which a clone or checkout resets.
  - The empty Drafts tab says there are no drafts instead of "Nothing matches."
  - Shortcuts in Settings and tooltips show Ctrl off a Mac, as the top bar already did.
  - The entry's details no longer show a "Version" that was the file's content hash.
  - An asset field's placeholder and an asset key error no longer name the shop example, and a missing key says it is missing instead of `"null" is not an asset key.`

- 22c6e47: Studio fixes from a review of the last release's UI work.

  - **The editor's menus and inline code look like Studio again.** Since the editor started loading on demand, Milkdown's stylesheet arrived after Studio's and won ties: the slash menu had no background or shadow, and inline code lost its font and fill. It now sits in a cascade layer under Studio's own styles.
  - **The publish sheet no longer re-renders without end while drafts load.** On a slow GitHub workspace it spun until the drafts answered, and forever if they never did. It shows a placeholder, or the error with Try again, and names the action from the workspace as the top bar does.
  - **A failed workspace request shows the error and Try again** in Agents, Branches, History, Media and the Inbox, instead of a placeholder that never ends.
  - **Deleting several entries goes past one that is refused,** says how many were deleted, keeps the refused ones selected, and refreshes the list either way.
  - **A bulk edit cut off partway refreshes the list** and says some entries may have been saved.
  - **If the editor's code fails to load, only the editor says so,** with Reload, and the entry's fields keep working.
  - **Keyboard:** j and k no longer move focus behind a confirm dialog. Arrow keys from a row's checkbox move from that row, not from the first.
  - **Words:**
    - Errors read as two plain sentences, with no em dash.
    - The "add a database" steps include removing `index = "static"`.
    - Health shows no drift columns when there is no index.
    - Media doesn't offer uploads without a database.
    - Discard on entries with no drafts says there is nothing to discard.

- Updated dependencies [b56d6b1]
- Updated dependencies [d854102]
- Updated dependencies [ef9af08]
- Updated dependencies [70321c7]
- Updated dependencies [d016963]
- Updated dependencies [36472f3]
- Updated dependencies [e61014f]
- Updated dependencies [de7e5d6]
- Updated dependencies [9d26068]
- Updated dependencies [41c371f]
  - @usegraft/compiler@1.0.0-beta.8
  - @usegraft/db@1.0.0-beta.8
  - @usegraft/mdx-safety@1.0.0-beta.8
  - @usegraft/core@1.0.0-beta.8
  - @usegraft/assets@1.0.0-beta.8
  - @usegraft/contracts@1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- c997e35: Content can now live in your Postgres database instead of in git. Add
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

- a761a13: Moving content between the database, your files and git.

  - `graft pull` writes what is published into your files, and `graft push`
    publishes the files you changed. Graft remembers what each file was pulled
    at (`.graft/sync.json`), so a pull never overwrites your changes, and a push
    is refused with `CONTENT_CONFLICT` if someone published that document since.
    `--force` settles a conflict either way.
  - `graft dev` tells you when someone publishes, so you know your files are
    behind. Agents get the same answer from the new MCP tool `sync_status`.
  - `content.mirror` copies what is published into GitHub: in batches from
    `graft serve` (`mode: "batch"`, every `everyMinutes`), or after every publish
    (`mode: "each"`). `graft mirror` does one run. A batch is one commit, or one
    pull request merged straight away when the branch allows it. A pull request
    that waits on checks or a review stays the only one: later runs add to it
    until it merges.
  - `graft check` runs every check a publish makes on the files, with no
    database, and now also finds references to documents that don't exist.
  - `graft ci changes`, `graft ci skip-build` and `graft ci init` keep CI cheap
    on content-only changes. `skip-build` compares with the previous deploy, and
    builds when it can't tell which that was.

  For git-sourced projects hosted on GitHub, some publishes now open a pull
  request even for an editor: deletions and renames, and changes over 200 lines.
  Studio says why. Change the rule with `content.review` (`deletes`,
  `collections`, `overLines`), or turn it off with `review: false`.

  `graft db migrate` adds the `content_mirror` table.

- 2d97fda: Studio accounts: people sign in to a hosted Studio with an email and a password.

  - The first visit creates the owner account. On a server anyone can reach,
    it asks for a setup code first, which `graft serve` prints when it starts
    and `graft studio setup-code` prints from the site's settings.
  - Admins invite people from Settings, People: an email and a role make a link
    to pass on. The same list changes roles, makes a link to set a new password,
    and removes access, which signs that person out at once.
  - Account sessions live in the database, so signing out, removing someone or
    changing their role takes effect on their next request. Changing your
    password signs out your other browsers. Five wrong passwords in a row lock
    an account for 15 minutes.
  - Admins get the new `studio:people` scope. GitHub sign-in and
    `graft studio invite` links work as before.
  - New tables `studio_users`, `studio_sessions` and `studio_invites`: run
    `graft db migrate`, and `graft harden <role>` again if you use a runtime role.

- 21b232a: Studio's developer views follow the docs. Health leads with its numbers
  without boxes or a decorative chart, lists collections, recent compiles,
  approvals and branches as plain tables, and has a Compile button again, so
  out-of-date content is fixed where Studio shows it. Schema shows types as
  plain identifiers and "Required" as a word instead of a pill, and the sign-in
  page uses the `graft. / Studio` wordmark. States read "Out of date", "Never
  compiled" and "File missing" in place of "Drifted", "Not indexed" and
  "Orphaned".
- fe7d03b: Studio's editor screens follow the docs. Home opens with what is waiting for
  you (drafts, an agent waiting on an approval, a pull request in review) and a
  plain table of collections, in place of the printed-paper front page. The
  collection list marks drafts with a dot and a word instead of a pill. The
  entry page sits in the docs' column at the docs' reading size, with no card
  around it.

  One word for one state: an edit not yet committed or published is a Draft
  everywhere, and every sentence uses the workspace's own verb, so a Studio on
  a laptop says "commit" and never "publish".

- e8b55ac: Studio keeps each entry's history, puts every decision in one inbox, and
  shows what was published lately.

  - **History.** The entry's panel has a History tab. It lists every published
    version with who made it and when. Open one to see how the entry differs
    from it now, then restore it as a draft. History comes from the published
    revisions when content is in the database, the production branch's commits
    on GitHub, and the checkout's commits locally. New API routes:
    `GET /entry/history` and `GET /entry/version`.
  - **Inbox.** Changes sent for review and agents asking before a destructive
    call share one inbox, with a count in the sidebar. When content is in the
    database, someone who can publish publishes a review from there. Approvals
    move out of the Developer views, and old `#/dev/approvals` links open the
    inbox.
  - **Home.** A "Recently published" feed lists who published what, with
    links to the entries (`GET /activity`).
  - Content stores gain optional `history`, `readVersion` and `activity`
    methods. `DatabaseStore` and `GitHubStore` implement them, and
    `@usegraft/db` adds `publishedHistory`, `recentlyPublished` and
    `readPublishedRevision`.

- b086a62: Studio gets a media library, agent tokens, and the site's settings with deploy
  hooks.

  - **Media.** A Media page lists the files in the asset store that Studio
    uploaded or an entry uses. Upload, search, write alt text, see which entries
    use a file, and delete one nothing uses. Image fields have Choose…, and a gallery's Add image, which pick from the same library and take the file's alt text when the field has none. New routes under `/api/studio/v1/assets`.
  - **Agents.** Admins make a token per agent under Developer, Agents, with
    Read, Write drafts or Publish access. The token is shown once and only its
    hash is stored. `graft serve` accepts it on `/api/mcp`, the Studio API and
    functions, and revoking it takes effect on the next request. No token can
    decide approvals. `@usegraft/auth`'s resolver gains a `tokens` option for
    this.
  - **Site and deploy hooks.** Settings has the site's name and address, and
    deploy hooks: URLs called with a `POST` after every publish of
    database-sourced content, with an optional bearer secret. Each hook shows
    what it answered last, and Send a test calls it now. A failing hook never
    undoes a publish. `@usegraft/compiler` exports `fireDeployHooks`.
  - New scope `studio:settings`, held by admins.
  - A Studio route that needs a table the database doesn't have answers
    `MIGRATION_REQUIRED` (503) with the fix, instead of failing the request.

  Run `graft db migrate` (migration 0013 adds `assets`, `agent_tokens`,
  `site_settings` and `deploy_hooks`). Run `graft harden <role>` again if you
  use a runtime role.

- 132107f: Studio now uses the docs' type, color and icons. IBM Plex Sans and Plex Mono
  replace Geist and Instrument Serif, and mono is kept for identifiers (a slug,
  a path, a field name) instead of labels. Labels are sentence case with no
  letter-spacing, nothing is under 13px, and weights are 400, 500 and 600.

  Color follows the docs' rule, monochrome chrome and colorful content: states
  are a mark and a word on the neutral ramp, amber is kept for something waiting
  on a person, red for errors and deletes, and diffs keep their code colors.
  Collections are marked by an icon in the text color, not a tinted tile.

  Icons are Lucide, at 16px and a 1.75 stroke, as in the docs.

  **BREAKING (panels embed only):** if you embed `@usegraft/studio/panels`,
  install `lucide-react` in place of `@phosphor-icons/react`. It is the optional
  peer the panels now import. `graft studio` and `graft serve --studio` need
  nothing.

- b146045: Studio's frame and popups now match the docs. A 56px top bar runs across the
  page with the `graft. / Studio` wordmark and the branch on the left, search
  centred, and Commit (or Publish) and the account menu on the right. The
  sidebar sits under it on the page colour. Below 768px the sidebar opens from a
  menu button.

  Popups share one material: the elevated surface and a 10px radius, opening in
  160ms and closing in 100ms. Dialogs and sheets add a dimmed backdrop with no
  blur and a visible close button; the command palette opens instantly and closes
  on Escape or a choice. Deleting or discarding asks in a confirm dialog that starts on
  Cancel and names the action ("Delete post") in place of the browser's
  `confirm()`. The command palette shows its keys, menus carry icons, toasts
  come one at a time, and committing ends with a plain check instead of an
  animation.

  `@usegraft/tokens` adds `--scrim`, the colour behind a dialog or sheet.

- cafd545: Studio opens an entry as panes. The collection's list stays beside the
  document, with the open entry marked, so the next entry is one click away and
  the arrow keys move through the list. A new inspector beside the document shows
  the entry's status, where it is saved, its file and version, and what changed;
  ⌘\ or Ctrl+\ hides it for a full-width page. Under 1280px it opens over the
  document instead, and the list gives way under 1024px. Every pane header is
  the same height, and all of Studio's spacing now comes from the `--space-*`
  scale.

### Patch Changes

- d6aec19: Opening the account, sort or filter menu no longer turns Studio into a blank
  page. Each menu put its label outside a group, which the menu library refuses,
  and nothing caught the error. Menu labels now always come with their group,
  menu items sit on one line, and a rendering error shows what went wrong with a
  Reload button instead of a white page.
- Updated dependencies [c997e35]
- Updated dependencies [95ecc3e]
- Updated dependencies [a761a13]
- Updated dependencies [2d97fda]
- Updated dependencies [e8b55ac]
- Updated dependencies [b086a62]
  - @usegraft/db@1.0.0-beta.7
  - @usegraft/compiler@1.0.0-beta.7
  - @usegraft/contracts@1.0.0-beta.7
  - @usegraft/core@1.0.0-beta.7
  - @usegraft/mdx-safety@1.0.0-beta.7
  - @usegraft/assets@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- 2386e74: Field descriptors now match what the validator checks. A pattern's flags are kept in the new `constraints.patternFlags`, so Studio checks `/^[a-z]+$/i` case-insensitively like the server does instead of flagging valid values. Constraints are listed only for the field types that enforce them: `field.string({ min: 10 })` validates nothing, so `describe_schema` no longer advertises a minimum for it.
- 2386e74: A save to a GitHub draft can no longer be lost while the draft is being emptied. Publishing everything or discarding the last change used to read the draft branch and then delete it, and a save that landed in between was deleted with it after reporting success. The draft is now emptied with a fast-forward that fails if the branch moved, so the branch stays, holding no changes, and the next save reuses it.

  Invite-link editors get new draft branch names. Their key joins the hash with `--`, which a GitHub login cannot produce, so a login shaped like an email's key (`ana-lima-shop-test-0123456789`) no longer shares that person's draft. A draft saved under the old name before upgrading stays on GitHub as a branch: publish or discard it first, or merge it by hand.

- 2386e74: One loopback list decides every "https unless loopback" question: `@usegraft/compiler` exports `LOOPBACK_HOSTS` and `isLoopbackHost`, and the revalidate webhook, Studio's `Secure` session cookie and `graft studio invite` all use them, so the invite check and the cookie can never disagree about a host. Paths under a regular file now read as absent instead of failing with `ENOTDIR`, and deleting a document that is already gone succeeds.
- 2386e74: A hosted Studio's change diff keeps its memory bounded. It kept a copy of the whole search frontier for every changed line, so a large rewrite (two 10,000-line versions with nothing in common) needed gigabytes and could take the server down. It now skips the unchanged start and end, keeps only the part of the frontier each step uses, and past 2,000 changed lines falls back to every old line removed and every new line added. As before, the drawer renders at most 600 lines and marks a longer diff as truncated. A hunk whose old or new side is empty now starts at the line before it, as git does (`-0,0` for a new file).
- 2386e74: `@usegraft/studio` also exports `ContentChangeNotice` and `ReviewRequest`, the two types its editor DTOs refer to, so typing a response needs one import instead of a second one from `@usegraft/compiler`.
- 2386e74: Studio fixes from review:

  - Discarding a local file that was staged as new and then deleted works, including in a repository with no commits yet. It used to try to restore it from HEAD, where it never was.
  - Local drafts report each changed file's version, as GitHub drafts do. Only a deletion has none.
  - A failed GitHub sign-in returns to the page the person started from, branch and hash kept, instead of Studio's front page. That needs the sign-in's own state cookie: a callback without a valid one still lands on the front page.
  - Slugs drop every combining mark, not only those in U+0300 to U+036F, so a title with one no longer gains a hyphen mid-word.
  - "News", "series", "species", "media" and "data" keep their form in the singular ("New news" became "New new").
  - `ContentTreePanel` follows a change to its `branch` prop. It kept showing the first branch.
  - The first render after a view starts loading shows the loading state, not an empty page.
  - The vermilion scale uses the same lightness steps as the other hues, so unpublished-state colour reads at the same brightness.
  - `WorkspaceDto.sessions` is documented as what it is: whether the request carried a session cookie.

- Updated dependencies [2386e74]
- Updated dependencies [2386e74]
- Updated dependencies [2386e74]
- Updated dependencies [2386e74]
- Updated dependencies [2386e74]
- Updated dependencies [2386e74]
  - @usegraft/compiler@1.0.0-beta.6
  - @usegraft/core@1.0.0-beta.6
  - @usegraft/contracts@1.0.0-beta.6
  - @usegraft/db@1.0.0-beta.6
  - @usegraft/mdx-safety@1.0.0-beta.6
  - @usegraft/assets@1.0.0-beta.6

## 1.0.0-beta.5

### Minor Changes

- ab7cca3: Studio has an editor API on top of the content store. `GET /api/studio/v1/entries` returns a page of a collection searched, filtered, sorted and faceted on the server, from a listing that re-parses only files whose size or mtime changed, so a catalog of thousands stays fast. `GET/PUT/POST/DELETE /api/studio/v1/entry` and `POST /api/studio/v1/entry/duplicate` read, save, create (slug from the title), delete and copy entries; a save that sends the version it read as `baseVersion` is refused with `CONTENT_CONFLICT` when that version is stale (a save without one is unconditional). `/api/studio/v1/drafts`, `/drafts/diff`, `/drafts/publish` and `/drafts/discard` list unpublished changes, diff them, publish them and throw them away: a commit in your checkout locally (you push it yourself), a commit on the production branch or a pull request on GitHub. `GET /api/studio/v1/workspace` says where saves land and what Publish does for the caller. `graft serve --studio` writes through GitHub when `GRAFT_GITHUB_REPO` is set along with a credential (`GRAFT_GITHUB_TOKEN`, or a GitHub App). Locally, every save, create, delete and discard compiles, then calls `onContentChange` when one is configured and the content changed, so the app refreshes the way it does for the old routes; a failed refresh comes back as `refresh: { ok: false }` and Studio warns.
- ab7cca3: Studio is rebuilt for editors. Content comes first: a home page with what is waiting to publish and the collections as a table of contents, a table per collection searched, filtered, sorted and paged on the server with bulk publish, discard and delete, and an entry editor that shows the title in the site's display face, every field with its label, limits and help, and the content in the rich editor. Fields edit in place, including choices, money, references with a search picker, tags, image galleries, nested groups and repeatable lists such as product variants; "Edit in Raw MDX" is gone as the only way to change them. Problems are reported on the field in plain words before a save, and a change made elsewhere since the entry was opened is reported instead of overwritten. Publishing happens in one sheet that names what will happen (publish, submit for review, or commit), lists the changes as entries with their changed fields ("Price: $139.00 → $145.50"), resolves conflicts, and discards. New entries ask only for required fields. A hosted Studio shows a sign-in screen. Index health, schema, history, branches, approvals and settings move under Developer. `ContentTreePanel` now renders the full editor.
- ab7cca3: **Breaking:** remove `GET` and `PUT /api/studio/v1/document` and the `DocumentDto` type. Use `GET` and `PUT /api/studio/v1/entry`, which read and save the same files, carry a version for conflict detection, and work against a GitHub store too. An entry deleted in a draft now stays in `/entries` as `status: "deleted"`, and `GET /entry` returns its published copy so it can be read or restored.
- ab7cca3: A hosted Studio now has sign-in. Set `GRAFT_STUDIO_SECRET` and people sign in with GitHub (`GRAFT_GITHUB_CLIENT_ID` and `GRAFT_GITHUB_CLIENT_SECRET`) or with an invite link from `graft studio invite <email> --role editor`, into a signed, HTTP-only session cookie. `GRAFT_STUDIO_EDITORS` lists who may sign in with GitHub and with which role; without it, anyone with write access to the content repository can. An invite link signs its holder in with the role it was made with, whether or not they are on that list. Roles map to scopes: `viewer`, `contributor` (drafts, publishing opens a pull request), `editor` (adds the new `studio:publish` scope) and `admin` (adds `approvals:decide`). Bearer tokens keep working beside sessions.

### Patch Changes

- ab7cca3: Committing a staged rename from Studio works: the old path is recorded as removed instead of passed to `git add`, which refused it because the file is gone.
- 3b396c0: `@usegraft/studio` exports the types of the editor API: `EntryDto` (the replacement for the removed `DocumentDto`), `EntryList`, `EntrySummary`, `SaveEntryResult`, `WorkspaceDto`, `DraftsDto`, `DraftDiffDto`, `PublishResultDto` and the types they use. Code that calls `/api/studio/v1/entry` can type its responses without copying them.
- Updated dependencies [ab7cca3]
- Updated dependencies [ab7cca3]
  - @usegraft/compiler@1.0.0-beta.5
  - @usegraft/contracts@1.0.0-beta.5
  - @usegraft/core@1.0.0-beta.5
  - @usegraft/db@1.0.0-beta.5
  - @usegraft/mdx-safety@1.0.0-beta.5
  - @usegraft/assets@1.0.0-beta.5

## 1.0.0-beta.4

### Minor Changes

- 4831a77: Graft now tells your app when content changes, so its cache refreshes without
  a manual call.

  Before this, an agent's `write_content` or a Studio save updated the index and
  returned the ChangeSet to the caller. The app kept serving its cached pages
  until someone called its revalidate route by hand.

  **Webhook.** Set `GRAFT_REVALIDATE_URL` and `GRAFT_WEBHOOK_SECRET` where
  `graft serve`, `graft studio`, `graft mcp`, `graft merge` or `graft migrate`
  runs. After each local write that changes the index, Graft POSTs
  `{ branch, gitSha, changes }` with `Authorization: Bearer <secret>`, the body
  the documented revalidate route already reads. The URL must use https, except
  on loopback (`localhost`, `127.0.0.1`, `[::1]`), and redirects are refused. A URL without a secret stops the
  command before it connects to anything. `graft compile` does not call the
  route, because a deploy compiles before the new version is live. A write to a
  GitHub-backed store is a draft and calls nothing: the app refreshes when a
  publish reaches the production branch and the host rebuilds.

  **Hook.** `createGraftMcp`, `createGraftMcpHandler`, `createStudioApiHandler`
  and `createStudioHandler` take `onContentChange(event)`. An app that mounts the
  MCP endpoint itself refreshes in-process:

  ```ts
  createGraftMcpHandler({
    // …
    onContentChange: ({ branch, changes }) => {
      revalidateContent(branch, changes);
    },
  });
  ```

  `@usegraft/compiler` exports the pieces: `notifyContentChange`,
  `createRevalidateWebhook`, `revalidateWebhookFromEnv` and the
  `ContentChangeEvent` / `ContentChangeListener` types.

  **A failed refresh never fails the write.** The write already landed. The
  server logs the new `REVALIDATE_FAILED` error, `write_content` and
  `delete_content` return `refresh: { ok: false, error, message, fix }`, and
  Studio shows a warning toast. Writes that change nothing do not call the
  listener.

  Also fixed: saving a document with an empty body a second time appended a
  newline to the file, so it projected as a change. `composeDocument` now leaves
  a body-less document byte-identical.

### Patch Changes

- Updated dependencies [4831a77]
  - @usegraft/compiler@1.0.0-beta.4
  - @usegraft/contracts@1.0.0-beta.4
  - @usegraft/core@1.0.0-beta.4
  - @usegraft/db@1.0.0-beta.4
  - @usegraft/mdx-safety@1.0.0-beta.4
  - @usegraft/assets@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- f92b97c: `@usegraft/sdk-next` now works on Next.js 15 as well as 16, and needs a
  release with the 2026 security fixes. The peer ranges are
  `next@^15.5.24 || ^16.3.3` and `react@^19.0.0`. CI builds and serves a real app
  on each major, type-checks the Next.js guide's examples against it, and checks
  reads, MDX, targeted refresh and `updateContent` in a real Server Action.

  The package used to declare Next.js 15 or newer while calling APIs that only
  Next.js 16 has. What changed for you:

  - **Breaking:** the peer range now starts at 15.5.24 and 16.3.3, the first
    releases that fix the critical Next.js advisories published in 2026. Upgrade
    Next.js if you are on an older 15.x. Next.js 14 is not supported: it no
    longer gets security fixes, and those advisories are still open on it.
  - `createGraft`, `MdxBody` and `revalidateContent` work on 15 and 16. On
    Next.js 15, tag your reads with `unstable_cache(fn, keys, { tags: tagsFor(...) })`.
    The Next.js guide shows both paths.
  - `updateContent` still needs Next.js 16. On 15 it now throws a `GraftError`
    with code `FRAMEWORK_VERSION_UNSUPPORTED` whose `fix` names
    `revalidateContent`. Before, the package imported `updateTag` by name, and
    Next.js 15 does not export it.
  - `@usegraft/sdk-next/config`, `@usegraft/sdk-core/db` and
    `@usegraft/studio/panels` now resolve their types under
    `moduleResolution: "node"`, the setting Next.js 15 writes into a new
    tsconfig. Before, those imports had no types there, and reads came back
    typed as `unknown`.

  `FRAMEWORK_VERSION_UNSUPPORTED` is a new error code, with an entry in the error
  reference and in `explain_error`.

- Updated dependencies [56c0957]
- Updated dependencies [56c0957]
- Updated dependencies [f92b97c]
  - @usegraft/assets@1.0.0-beta.3
  - @usegraft/db@1.0.0-beta.3
  - @usegraft/contracts@1.0.0-beta.3
  - @usegraft/compiler@1.0.0-beta.3
  - @usegraft/core@1.0.0-beta.3
  - @usegraft/mdx-safety@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- 98ff4ba: Clear leftover CodeQL findings: no ReDoS regex on storage URLs, no exception text on `/healthz` or Studio asset-url failures, and `graft studio` only opens a validated loopback URL.
- Updated dependencies [98ff4ba]
  - @usegraft/assets@1.0.0-beta.2
  - @usegraft/compiler@1.0.0-beta.2
  - @usegraft/contracts@1.0.0-beta.2
  - @usegraft/core@1.0.0-beta.2
  - @usegraft/db@1.0.0-beta.2
  - @usegraft/mdx-safety@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- 27b8468: Dependency floors raised to versions without known advisories.

  `main` was carrying 34 Dependabot alerts, and a range-respecting update across
  the workspace clears 23 of them: `next` 16.2.9 → 16.3.3 (nine alerts on its
  own), `hono` 4.12.27 → 4.13.5, `postcss` 8.4.31 → 8.5.23, plus `astro`, `tar`,
  `sharp`, `svgo`, `@astrojs/vercel` and `@hono/node-server`.

  Declared ranges move with the lockfile, which is what makes this a change worth
  a version rather than a lockfile refresh: `zod` `^4.1.0` → `^4.5.4`, `jose`
  `^6.0.0` → `^6.2.10`, `jiti` `^2.4.0` → `^2.7.0` and the React type packages.
  Every one is a floor raised inside the same major. **No peer range changed** —
  `sdk-next` still peers `next >=15.0.0`, `sdk-react` still peers `react >=18.0.0`
  — so nothing a consumer already resolves stops resolving.

  Eleven alerts survive this and are deliberately not addressed here. Two are
  `vitest`, pinned at `^2.1.9` against a fix in `3.2.6`: a major upgrade of the
  test framework is its own change, not a line in a dependency bump. The other
  nine are transitive versions their parents pin — `esbuild` now resolves
  `0.28.1` and `0.28.2` alongside `0.18.20`, `0.21.5`, `0.25.12` and `0.27.7`,
  and only `pnpm.overrides` dislodges those. Each override is a compatibility bet
  and belongs where it can be argued one at a time.

- 52fc3e6: Install commands drop `@beta`. A plain install is now the right install.

  Every README said `npm i @usegraft/<pkg>@beta`, because `latest` pointed at
  `0.2.0` while the docs described `1.0.0-beta.x`. Writing the tag into 22 files
  treated the symptom. The defect was the dist-tag: `latest` is what a bare
  install resolves, and it resolved to somewhere nobody should land.

  `latest` now points at the prerelease across all 21 published packages, and the
  `0.x` line is deprecated, so the tag has nothing left to do. `install-tag.mjs`
  inverts with it — it strips tags instead of adding them, and CI fails if one
  comes back.

  The half a script cannot check is the registry. Publishing a prerelease while
  `latest` sits on something older reopens the original bug and nothing in the
  repo will notice. That property is kept by moving the tag at release, and it is
  written down in the script rather than assumed.

- Updated dependencies [27b8468]
- Updated dependencies [52fc3e6]
  - @usegraft/contracts@1.0.0-beta.1
  - @usegraft/core@1.0.0-beta.1
  - @usegraft/assets@1.0.0-beta.1
  - @usegraft/compiler@1.0.0-beta.1
  - @usegraft/db@1.0.0-beta.1
  - @usegraft/mdx-safety@1.0.0-beta.1

## 1.0.0-beta.0

### Patch Changes

- a6b7ddf: **BREAKING:** `writeDocumentFile(root, sourcePath, raw)` replaces
  `writeDocumentFile(fullPath, raw)`, and contains the path itself. It returns
  the resolved path.

  `.greptile/rules.md` told reviewers that "every filesystem sink in
  `@usegraft/compiler` performs path containment with symlink refusal". That was
  false. `writeDocumentFile` took an already-resolved path and wrote it. Studio
  resolved carefully before calling — its source even carries a comment about
  `"../../../../tmp/pwn"` arriving as a clean-looking `"pwn"` — while MCP's
  `write_content` did not, which is how a traversal shipped in a package whose
  own review rules said it could not.

  Containment that lives in each caller is not an invariant, because the next
  caller does not inherit it. The sink no longer trusts its input, so the rule is
  now true rather than aspirational. The rule text was corrected too, and says
  what went wrong, since a rule that has been false once is worth annotating.

  Raised by cubic on the pull request, against the rules file rather than the
  code.

- Updated dependencies [2561b47]
- Updated dependencies [15568eb]
- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [a6b7ddf]
- Updated dependencies [a442299]
  - @usegraft/core@1.0.0-beta.0
  - @usegraft/mdx-safety@1.0.0-beta.0
  - @usegraft/contracts@1.0.0-beta.0
  - @usegraft/db@1.0.0-beta.0
  - @usegraft/compiler@1.0.0-beta.0
  - @usegraft/assets@1.0.0-beta.0

## 0.2.0

### Minor Changes

- 61b9ac4: Approval decisions are attributed to a verified identity, never to caller input.

  `decideApproval` took a `decidedBy: string` that every surface let the caller
  supply. That string is the entire separation-of-duties control — the UPDATE's
  WHERE clause compares it against `requested_by_id` — so anyone who could name it
  could approve their own destructive operation by naming somebody else. The
  guard was decorative.

  **Breaking:**

  - `decideApproval(db, id, decision, decidedBy)` now takes an `ApprovalDecider`
    (`{ kind, id }`) instead of a string.
  - The MCP `decide_approval` tool no longer accepts a `decidedBy` argument. It
    attributes the decision to the identity the connection authenticated as, via
    the new `connectionActor` option, and refuses an unauthenticated connection.
  - `POST /api/studio/v1/approvals/{id}/decide` ignores `decidedBy` in the body;
    the Studio's `decidedBy` mount option is now `decider: ApprovalDecider`.
  - An approval whose requester has no stable id is **undecidable**
    (`APPROVAL_UNATTRIBUTED`). The old `requested_by_id IS NULL` arm made those
    approvable by anyone, including whoever filed them.
  - A human-gated function called by an actor with no stable id is refused with
    `UNAUTHORIZED` instead of filing an approval nobody can be accountable for.

  Adds a `decided_by_kind` column (migration `0008`) so attribution records what
  kind of actor decided, matching `requested_by_kind`.

- 52d7488: `graft compile` refuses executable MDX, and the project declares its own trust.

  `MdxBody` refuses `{…}` expressions and `import` at render by default, and the
  write paths refuse them on the way in. `graft compile` checked nothing, on the
  reasoning that content already in git arrived through code review.

  That left the compiler and the renderer disagreeing. A git-authored expression
  body compiled, indexed, and then failed at render, per request, on the page, in
  production. Compile now checks every authored body and reports every offending
  document at once, so the failure lands at build time.

  `export const mdxTrust = "full"` in `graft.config.ts` is the escape, for the
  case ADR 0004 names: every author has commit access, so code review really is
  the control. It defaults to `"restricted"`, and an unrecognised value is refused
  rather than defaulted.

  `MdxBody`'s `trust` prop is unchanged. The two settings have to agree, so
  compile's error names both.

  **Breaking:**

  - `graft compile` fails on authored MDX containing `{…}` expressions, `import`,
    `export` or spread attributes, unless the project sets `mdxTrust = "full"`.
    Evidence the break is narrow: all 28 authored `.mdx` files across both
    examples compile unchanged.
  - MDX the checker cannot parse is refused rather than indexed.

  **New:** `readDocs` takes a third options argument; `CompileOptions`,
  `CompileStaticOptions`, `GraftMcpOptions` and `StudioApiOptions` gain an
  optional `mdxTrust`. All default to `"restricted"`, so a call site that omits it
  is safe rather than permissive. `MdxTrust` is declared in `@usegraft/mdx-safety` and
  re-exported from `@usegraft/sdk-next`, which used to declare its own copy of
  the same union. Same name, same shape, so nothing importing it has to change.

  See `docs/adr/0006-compile-refuses-executable-mdx.md`.

- 4bde361: Host validation and CSRF protection for the local Studio.

  A loopback Studio has no authentication by design, so anything that can reach
  `127.0.0.1` can act. Browsers let a page do exactly that: every Studio mutation
  is a plain POST/PUT parsed with `request.json()`, which ignores Content-Type —
  so a cross-origin "simple request" carrying `text/plain` executed with no CORS
  preflight. The attacker cannot read the response, but the side effect already
  happened: an approval decided, a document overwritten, a commit made.

  **Breaking:**

  - `createNodeListener(handler, { allowedHosts })` refuses a request whose `Host`
    is not one it answers to, with 400. `graft serve` and `graft studio` derive
    the list from their bind address. Without this an attacker-chosen Host flowed
    into every handler, and a browser resolving any name to `127.0.0.1` is exactly
    how DNS rebinding reaches a loopback bind.
  - The Studio API refuses state-changing requests whose `Origin` is cross-origin,
    and requires `Content-Type: application/json` on them — which forces a
    preflight for anything that omits Origin. Reads are unaffected.

  The shell redirect is now `Cache-Control: no-store`: it is built from the
  request's own Host and fires before any authorization runs, so a 302 cached by
  path alone would outlive the Host check.

  The Vite dev proxy rewrites `Origin` to the API's origin, since in development
  the browser's origin is the Vite server rather than the Studio.

- 1aea0da: Authored MDX no longer executes as JavaScript by default.

  `MdxBody` compiles with `outputFormat: "function-body"` and evaluates via
  `run()`, which is `new Function` in the host runtime — so `{expr}` and `import`
  in a stored body are arbitrary server-side JavaScript with `process`, `fetch`
  and dynamic `import()`. For content the operator wrote and reviewed in git, that
  is the feature. It stops being one as soon as an author is not the operator: a
  hosted Studio, or one a user runs for their own writers, makes "can write
  content" mean "can execute code on the render host" — and on shared
  infrastructure, on other tenants' hosts too.

  New package **`@usegraft/mdx-safety`**. It removes the executable surface rather
  than trying to contain it: `node:vm` is explicitly not a security boundary, and
  a worker thread cannot return React elements without breaking component identity
  under RSC. Prose, GFM and components with literal attributes all survive;
  `{…}` expressions, `import`, `export`, expression-valued attributes and
  `{...spread}` attributes are refused.

  **Breaking:**

  - `MdxBody` gains `trust?: "restricted" | "full"`, defaulting to `"restricted"`.
    Pass `"full"` only for bodies you know came from your own repository.
  - MCP `write_content` and Studio document saves refuse executable MDX.

  Checked at render as well as at write, because content can also arrive through a
  direct database write with the runtime credential — a path no write-side guard
  sees. All 28 authored files across both examples pass unchanged.

- f423a6e: Every package ships a README, a description, keywords and a LICENSE.

  `0.1.1` published sixteen packages with no README and, for fourteen of them, no
  `description` either. On npm that renders as a blank page and an unsearchable
  listing: `description` is the line npm search shows, and without keywords the
  packages are findable only by exact name.

  Each README says what the package is, how to install it, and shows one real
  example using its actual exports. The security-relevant ones state their
  defaults plainly, because "MdxBody refuses executable MDX by default" is
  something a reader should not have to find in an ADR.

  `LICENSE` is now copied into each package. `files: ["dist"]` does not exclude
  `README.md` or `LICENSE` (npm always packs those), but a licence file only ships
  if it exists in the package directory, and the root one does not count.

- 92fe85e: One path-containment helper, and it refuses symlinks.

  `resolveContained(root, path)` (new, in `@usegraft/compiler`) checks the bytes
  _and_ the filesystem. Lexical containment — `resolve` plus a prefix check —
  only answers "does this string stay under the root", which a symlink **inside**
  the root silently defeats: `docs/notes.mdx -> ~/.ssh/id_rsa` passes every string
  test and `readFileSync` then follows it. Git can commit symlinks, so a cloned
  template can plant one.

  **Breaking:**

  - MCP `put_asset` no longer reads arbitrary server paths. Its `path` argument
    requires the new `localUploadRoot` option, which only `graft mcp` sets (to the
    project directory) — every remote mount refuses it. Previously the raw string
    went to `readFileSync`, the bytes were stored under a caller-chosen key, and
    the response included a fetchable URL, so one call read `.env` off the server.
  - Studio `writeDocument` validates the slug against `SLUG_RE` and contains the
    resulting path. `parseDocument`'s existing check did not help: it validates
    `basename(sourcePath)`, which strips exactly the `..` segments that make a
    path dangerous.
  - `loadItem` validates the item name before joining it onto the registry root.
    `describe_item` passed a raw MCP argument through, and the three error
    branches were distinguishable — a filesystem existence oracle.
  - `safeContentPath` now refuses symlinks, so a hostile repository can no longer
    leak files through the changes-diff endpoint.

  Also fixes `looksBinary`, which read an entire file into memory to inspect its
  first 8KB — one large file made every diff render allocate all of it.

  `SLUG_RE` is now exported from `@usegraft/compiler`.

- 6ebfe18: Authorization is per-route and scope-based. Being authenticated is no longer
  enough to reach operator-only surfaces.

  The Studio's `authorize` was `(request) => boolean` — an interface too narrow to
  express "may this actor do _this particular thing_", so callers invented their
  own policy. What `graft serve` invented was `actor.kind !== "anonymous"`, which
  admits every agent: `GRAFT_DEV_TOKEN` mints `{ kind: "agent" }` and OIDC issuers
  default to the same. Any agent holding a normal runtime token could approve
  destructive operations, write documents, commit, and revert.

  MCP had the mirror problem: scopes were consulted only inside `run_function`'s
  access rules, so `write_content`, `put_asset`, `delete_content` and
  `decide_approval` were available to any authenticated caller whatever their
  token permitted.

  **Breaking:**

  - `StudioApiOptions.authorize` is replaced by `authenticate`, which returns a
    `StudioPrincipal` (`{ kind, id, scopes }`) or `null` to refuse.
  - Studio routes require scopes: `studio:read` for reads, `studio:write` for
    mutations, `approvals:decide` for the approval decision. The requirement is
    computed in one place, so a new route cannot be added without one.
  - MCP `write_content`, `put_asset` and `delete_content` require `content:write`;
    `decide_approval` requires `approvals:decide`.
  - Approval decisions made through an authenticated Studio are attributed to the
    caller, not the mount-time identity.
  - `graft mcp` grants `content:write` locally (it runs on the operator's own
    machine) but deliberately not `approvals:decide`, so the CLI requesting and
    `graft approve` deciding remain different identities.
  - The landing-page example stops granting every self-registered account
    `submissions:read commerce:orders:read commerce:orders:write`. Scopes now come
    from a `GRAFT_OPERATOR_EMAILS` allowlist; one free signup previously dumped
    every contact submission and could mark arbitrary orders paid.

### Patch Changes

- d6cbc3d: Thirteen self-contained defects, led by a data-loss bug in the editor.

  - **The editor wrote one document's content into another document's file.**
    `persist` took `collection`/`slug` from the current route closure while taking
    the bytes from a ref. On an A → B navigation React re-renders with route=B
    before the pending flush runs, so A's edits were written to B's path,
    destroying it — and the toast said "Saved B/B". Identity now comes from the
    same snapshot as the content, via a new `buildSavePayload` that takes it as an
    argument, which makes the mismatch unrepresentable. Document loads are
    sequenced so out-of-order responses cannot show one document under another's
    route.
  - `updateRecord` read, merged and wrote with no lock, so two concurrent callers
    both merged over the same baseline and the second silently erased the first.
    Now one transaction with `SELECT … FOR UPDATE`, and the "unreachable"
    `throw new Error` is a real `DOCUMENT_NOT_FOUND`.
  - A malformed URL escape white-screened the Studio (`parseHash` runs in a
    `useState` initialiser, so the `URIError` threw during first render) and
    turned Studio asset and route-id requests into misleading 500s.
  - The compiled static index briefly did not exist: `rmSync` then `renameSync`
    left a window where readers got `STATIC_INDEX_NOT_FOUND`, and a crash between
    them destroyed the artifact. Now an atomic rename, falling back only on
    Windows.
  - Data migrations persisted the raw transform output instead of the validated
    result, so Zod defaults and coercions never reached the stored rows, and
    compared with key-order-sensitive `JSON.stringify` against jsonb that
    normalises key order — rewriting identical rows.
  - The generated `graft/index.ts` barrel emitted duplicate imports when two
    filenames collapsed onto one identifier (`my-mod.ts` and `myMod.ts`), in a
    file marked "do not edit". It now refuses and names both offenders.
  - `graft dev` kept watching the original content directory after a config reload
    moved it, so every later save was invisible.
  - OIDC tokens without a `sub` claim authenticated as an actor with no id.
    `requiredClaims: ["sub"]` now rejects them.
  - `applyPlan` trusted a conflict snapshot taken when the plan was built; it now
    re-checks disk immediately before each write.
  - A `??` chain in the pages-description migration short-circuited on an empty
    string, so the documented title fallback was never reached.
  - All four GitHub Actions are pinned to commit SHAs, and the release workflow's
    `id-token: write` is scoped to the publish job rather than the whole file.

- Updated dependencies [61b9ac4]
- Updated dependencies [02690dd]
- Updated dependencies [e0d4eda]
- Updated dependencies [52d7488]
- Updated dependencies [1aea0da]
- Updated dependencies [f423a6e]
- Updated dependencies [92fe85e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
- Updated dependencies [52d7488]
- Updated dependencies [d6cbc3d]
  - @usegraft/contracts@0.2.0
  - @usegraft/core@0.2.0
  - @usegraft/db@0.2.0
  - @usegraft/compiler@0.2.0
  - @usegraft/mdx-safety@0.2.0
  - @usegraft/assets@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/assets@0.1.1
- @usegraft/compiler@0.1.1
- @usegraft/contracts@0.1.1
- @usegraft/core@0.1.1
- @usegraft/db@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/compiler@0.1.0
  - @usegraft/assets@0.1.0
  - @usegraft/contracts@0.1.0
  - @usegraft/db@0.1.0
