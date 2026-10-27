# @usegraft/compiler

## 1.0.0-beta.9

### Minor Changes

- 42213aa: `graft check` and `graft compile` skip the executable-MDX scan for a body they have already scanned. Results are kept under `$XDG_CACHE_HOME/graft/mdx-safety` (by default `~/.cache/graft/mdx-safety`), outside the project, and are keyed on the body and on the version of every package the scanner runs, down its whole dependency tree. A repeat `graft check` on a 50-page site went from about 1.7 s to about 0.3 s.

  `@usegraft/mdx-safety` adds `scanMdx`, the `MdxScanCache` interface, `mdxScanVersion`, `mdxScanPackages` and `scanVersionOf`, and the compiler's `validateDocuments`, `compile` and `compileStatic` take an optional `mdxScanCache`. Studio saves and MCP writes do not pass one, so they scan every body every time.

### Patch Changes

- 42213aa: Static projects no longer load the Postgres code. `@usegraft/db/static` is a new entry with the SQLite content index, the content diff, the search query check and branch scopes, and no drizzle-orm or Postgres driver behind it. Core, the compiler and the MCP server load the rest of `@usegraft/db` only inside the functions that talk to Postgres. On a 50-page static site, `graft content get` went from about 950 ms to about 480 ms. Everything in `@usegraft/db/static` is still exported from `@usegraft/db`.
- Updated dependencies [9a17a95]
- Updated dependencies [42213aa]
- Updated dependencies [acb4a84]
- Updated dependencies [42213aa]
- Updated dependencies [3374aab]
  - @usegraft/contracts@1.0.0-beta.9
  - @usegraft/db@1.0.0-beta.9
  - @usegraft/core@1.0.0-beta.9
  - @usegraft/mdx-safety@1.0.0-beta.9

## 1.0.0-beta.8

### Minor Changes

- b56d6b1: **BREAKING:** `graft compile` now stops on a `field.reference({ to })` that
  names a document that doesn't exist, with `CONTENT_REFERENCE_NOT_FOUND`.
  Until now a reference was checked only by `graft check`, so a product whose
  category had been deleted compiled, and the site found the gap at render
  time. A project that compiled with a broken reference fails now. Run
  `graft check` to list every one, then fix them or create the missing
  documents.

  The error names each file, field and missing slug in `details.references`:

  ```txt
  Error CONTENT_REFERENCE_NOT_FOUND: 1 reference(s) name a document that doesn't exist: products/wool-hat.mdx "category" points at categories/hats.
  ```

  Both content sources make the check, because both go through
  `validateDocuments`. In a database-sourced project, a publish refuses a draft
  whose reference isn't live, and refuses to publish the deletion (or a new
  slug) of a document that live documents still point at. Publish them together,
  changed to point elsewhere.

  A local Studio checks the same way: a save of an entry whose reference isn't
  in the index is refused, and so is deleting an entry other entries point at,
  before its file is removed. `checkRemoval` in `@usegraft/compiler` is that
  second check, and `compileDocuments` makes the first.

  `validateDocuments` takes a new `references` option. `"files"` checks targets
  among the files given, which is right for a whole tree, and `readDocs` uses it
  by default. A set of `collection/slug` keys also counts those as existing, for
  a caller checking part of a larger whole. Without the option, references are
  not checked. `liveDocuments` in `@usegraft/db` lists a branch's live
  documents for that set.

- 70321c7: **BREAKING:** frontmatter is read as YAML or JSON only. gray-matter runs a `---js` frontmatter block through `eval`, so a contributor's Studio save, an agent's `write_content`, or a pull request built by `graft compile` could run code on the machine reading it. Every read now goes through `readFrontmatter` from the new `@usegraft/mdx-safety/frontmatter` entry, which refuses any other language with `INPUT_VALIDATION_FAILED` before parsing, whatever `mdxTrust` is. A lint rule stops gray-matter being imported anywhere else.

  **BREAKING:** `POST /api/studio/v1/changes/commit` and `POST /api/studio/v1/compilations/:id/revert` need `studio:publish`. They asked for `studio:write`, so a contributor could commit to the checkout, or roll it back, around the check Studio's Commit button makes.

  Also fixed:

  - `graft studio` with `GRAFT_DEV_TOKEN` gives the operator every admin scope, as its documentation says. Since contributors were stopped from committing locally, the token's missing `studio:publish` stopped the operator committing too.
  - Without a database, a media upload or delete is refused before the bucket is touched. Both used to change the bucket, then answer `NEEDS_DATABASE`.

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

### Patch Changes

- d016963: A save keeps the comment after an edited value. Changing `title: "Old" # shown in the tab` in Studio or over MCP used to write `title: "New"` and lose the note; it now writes `title: "New" # shown in the tab`. This holds for quoted and plain one-line values. A value that becomes a list or a map drops the comment, because it no longer has one line to sit on.
- de7e5d6: A save no longer turns a one-line string into a folded `>-` block. js-yaml wrapped any string longer than 80 columns, so editing a long `description` rewrote it across three lines. Strings now stay on one line, and an edited one-line string keeps the quotes it had (`"…"` or `'…'`).

  A frontmatter that opens with a comment is now patched key by key like any other, instead of being rewritten whole, which dropped the comment, re-quoted every string and lost the blank line after `---`. Comments and blank lines between keys stay put when the key above them changes.

- 9d26068: Studio no longer loops silently when opened over plain http on an address other than localhost. The session cookie is `Secure` there, so the browser dropped it and sign-in landed back on the form with no message. Studio now says sign-in needs https, or localhost, instead of showing a form that can't work, and an invite link stays unused until it can sign someone in.

  `graft doctor` and `setup_status` no longer make a missing `GRAFT_STUDIO_SECRET` the next step: it only matters once the site is online. That check now has its own id, `studio-secret`. With nothing else to do, doctor says the project is ready to work on and that the `!` lines are for going online. Once the secret is set, creating the owner account is still the next step.

  `graft --help` lists `graft studio setup-code` and `graft studio invite`.

- Updated dependencies [b56d6b1]
- Updated dependencies [d854102]
- Updated dependencies [ef9af08]
- Updated dependencies [70321c7]
- Updated dependencies [36472f3]
- Updated dependencies [41c371f]
  - @usegraft/db@1.0.0-beta.8
  - @usegraft/mdx-safety@1.0.0-beta.8
  - @usegraft/core@1.0.0-beta.8
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

- 95ecc3e: A new site in one command, and a checklist that says what to do next.

  - `npm create graft` (the new `create-graft` package) runs `graft create`: it
    asks what kind of site (blog, docs, shop, portfolio or blank), how people
    will edit it (online in Studio, or as files in git) and which database to
    use, then writes the site with a Next.js app, installs it, migrates, loads
    the example content and compiles. Every question has a flag, and `--yes`
    takes the defaults, so an agent can run it with no prompts.
  - `--database new` makes a free Postgres with no account. It lasts 72 hours
    unless claimed: `graft db claim` prints the link, waits for the claim, and
    saves the new connection string to `.env`. Any Postgres 13 or newer works
    instead.
  - `graft doctor` and the MCP tool `setup_status` check the database and its
    version, the schema, a database waiting to be claimed, content, the index
    and Studio sign-in, and end with the one thing to do next.
  - A new site gets an `AGENTS.md`, and the docs serve a setup guide for agents
    at `/start.md`.

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

### Patch Changes

- Updated dependencies [c997e35]
- Updated dependencies [a761a13]
- Updated dependencies [2d97fda]
- Updated dependencies [e8b55ac]
- Updated dependencies [b086a62]
  - @usegraft/db@1.0.0-beta.7
  - @usegraft/contracts@1.0.0-beta.7
  - @usegraft/core@1.0.0-beta.7
  - @usegraft/mdx-safety@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- 2386e74: Two error-handling fixes. `GRAFT_REVALIDATE_URL` with a `user:password@` part is refused at startup without repeating the credentials, and a network error that quotes the webhook URL has its query stripped, so a token in the URL no longer reaches logs, agents or Studio toasts. Creating a GitHub draft branch now reads only GitHub's "already exists" answer as a race: any other 422, such as a missing commit, fails with `REMOTE_STORE_FAILED` and GitHub's reason, where it used to retry to exhaustion and report the document busy.
- 2386e74: Paths inside the content directory now refuse a dangling symbolic link. The check followed the link, so a link whose target did not exist read as absent, and a Studio or MCP write then created the target outside the content directory. A delete on a read-only filesystem now fails with `CONTENT_TREE_READ_ONLY`, the same error a save gives, instead of a raw `EROFS`.
- 2386e74: A save to a GitHub draft can no longer be lost while the draft is being emptied. Publishing everything or discarding the last change used to read the draft branch and then delete it, and a save that landed in between was deleted with it after reporting success. The draft is now emptied with a fast-forward that fails if the branch moved, so the branch stays, holding no changes, and the next save reuses it.

  Invite-link editors get new draft branch names. Their key joins the hash with `--`, which a GitHub login cannot produce, so a login shaped like an email's key (`ana-lima-shop-test-0123456789`) no longer shares that person's draft. A draft saved under the old name before upgrading stays on GitHub as a branch: publish or discard it first, or merge it by hand.

- 2386e74: `GITHUB_STORE_ENV` now lists the host commit variables the store reads (`VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT`, `RAILWAY_GIT_COMMIT_SHA`, `COMMIT_REF`, `GITHUB_SHA`), exported on their own as `DEPLOYED_SHA_ENV`. A server that allowlisted its environment from the old list dropped them, so Studio could not tell which commit was deployed.
- 2386e74: One loopback list decides every "https unless loopback" question: `@usegraft/compiler` exports `LOOPBACK_HOSTS` and `isLoopbackHost`, and the revalidate webhook, Studio's `Secure` session cookie and `graft studio invite` all use them, so the invite check and the cookie can never disagree about a host. Paths under a regular file now read as absent instead of failing with `ENOTDIR`, and deleting a document that is already gone succeeds.
- Updated dependencies [2386e74]
  - @usegraft/core@1.0.0-beta.6
  - @usegraft/contracts@1.0.0-beta.6
  - @usegraft/db@1.0.0-beta.6
  - @usegraft/mdx-safety@1.0.0-beta.6

## 1.0.0-beta.5

### Minor Changes

- ab7cca3: Add the content store: where authored content is read from and written to, behind one interface. `FilesystemStore` is today's behaviour. `GitHubStore` writes through the GitHub REST API, so a hosted surface on a read-only filesystem can save: each editor drafts on their own branch, and publishing lands one commit on the production branch authored by the editor, or opens a pull request. Every write can carry the version it was read at and is refused with the new `CONTENT_CONFLICT` code when the document changed underneath it, which covers a second tab or an agent writing under the same identity. Editors draft apart, so between two editors the guard is at publish: it refuses to overwrite a document production changed since the draft began until someone chooses to keep the draft or take the published version. Credentials are a fine-grained token (`GRAFT_GITHUB_TOKEN`) or a GitHub App (`GRAFT_GITHUB_APP_ID`, `GRAFT_GITHUB_APP_PRIVATE_KEY`); `githubStoreFromEnv` reads the configuration. GitHub failures surface as `REMOTE_STORE_FAILED`: a refusal carries GitHub's own message and status, and an unreachable GitHub says so. `@usegraft/compiler/testing` exports an in-memory GitHub for tests.

### Patch Changes

- Updated dependencies [ab7cca3]
- Updated dependencies [ab7cca3]
  - @usegraft/contracts@1.0.0-beta.5
  - @usegraft/core@1.0.0-beta.5
  - @usegraft/db@1.0.0-beta.5
  - @usegraft/mdx-safety@1.0.0-beta.5

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
  - @usegraft/contracts@1.0.0-beta.4
  - @usegraft/core@1.0.0-beta.4
  - @usegraft/db@1.0.0-beta.4
  - @usegraft/mdx-safety@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- Updated dependencies [56c0957]
- Updated dependencies [f92b97c]
  - @usegraft/db@1.0.0-beta.3
  - @usegraft/contracts@1.0.0-beta.3
  - @usegraft/core@1.0.0-beta.3
  - @usegraft/mdx-safety@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- @usegraft/contracts@1.0.0-beta.2
- @usegraft/core@1.0.0-beta.2
- @usegraft/db@1.0.0-beta.2
- @usegraft/mdx-safety@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

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
  - @usegraft/db@1.0.0-beta.1
  - @usegraft/mdx-safety@1.0.0-beta.1

## 1.0.0-beta.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [2561b47]
- Updated dependencies [15568eb]
- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [a442299]
  - @usegraft/core@1.0.0-beta.0
  - @usegraft/mdx-safety@1.0.0-beta.0
  - @usegraft/contracts@1.0.0-beta.0
  - @usegraft/db@1.0.0-beta.0

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [61b9ac4]
- Updated dependencies [02690dd]
- Updated dependencies [e0d4eda]
- Updated dependencies [52d7488]
- Updated dependencies [1aea0da]
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
- Updated dependencies [52d7488]
- Updated dependencies [d6cbc3d]
  - @usegraft/contracts@0.2.0
  - @usegraft/core@0.2.0
  - @usegraft/db@0.2.0
  - @usegraft/mdx-safety@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/contracts@0.1.1
- @usegraft/core@0.1.1
- @usegraft/db@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/contracts@0.1.0
  - @usegraft/db@0.1.0
