# Studio v2: an editor for people, hostable, with writes that land in git

> Opened 2026-10-09. Pairs with `editor.md` (the L2 canvas) and
> `p7-5-docs-and-gallery.md` (the opt-in Studio, P7.5.3).
> Status: **units 1 to 6 shipped**, 7 and 8 next. See "Progress" at the end.

## The brief

Make the Studio something a non-technical content team can use, the way a
Sanity Studio is deployed for an editorial team: create, find, edit and publish
without knowing MDX, git, frontmatter, collections or the CLI. Make it hostable
with working edits. Make a product catalog of thousands of entries pleasant to
manage. Keep the thesis: git is the source of truth, and every Studio operation
also exists on MCP and the CLI.

## Audit

Walked as a non-technical editor against `examples/docs-site` (44 documents,
Postgres tier) on 2026-10-09, and read against the code. Graded on one rubric,
1 to 5, against Sanity Studio and Payload as the reference 5.

| Area                      | Grade | What a content editor meets today                                                                                                                                                                                               |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First impression          | 2     | A dashboard of index health: `ON DISK 44 / IN SYNC 44 / DRIFTED 0 / NOT INDEXED 0 / ORPHANED 0`, compilations, branches. Nothing about content.                                                                                 |
| Language                  | 1     | `Raw MDX`, `string required`, `drifted`, `compile`, `Commit`, `overlay · root`, `db-authoritative`, file paths in the header, field keys in uppercase mono. Every word is a developer's word.                                   |
| Find content              | 2     | A sidebar tree of every document. Fine at 40. At 2,000 products it is a scroll bar. No list view, no columns, no filters, no sort, no paging. Search is the command palette only.                                               |
| Create content            | 0     | There is no "New" anywhere. A new document needs a file on disk.                                                                                                                                                                |
| Delete, duplicate, rename | 0     | Not possible.                                                                                                                                                                                                                   |
| Edit fields               | 2     | Strings, numbers, booleans and assets are editable. Objects and arrays say "Edit in Raw MDX", which is a dead end for this user. No select, no reference, no slug. Field labels are the raw key.                                |
| Edit body                 | 3     | Milkdown is good, and the fidelity gate is the right instinct. JSX that is not a parsed component still shows as source (`<p className="kicker">…</p>`).                                                                        |
| Validation                | 1     | A toast containing the GraftError `message` and `fix` strings, which are written for an agent: `title: Too small: expected string to have >=1 characters`. Not tied to the field.                                               |
| Save state                | 3     | Autosave works and is careful. The state label is small mono caps in a corner.                                                                                                                                                  |
| Publish                   | 1     | "Changes" opens a git drawer and the button says "Commit". The footer says nothing is pushed. A second control says "N changes to compile". Two git concepts and one index concept stand between an editor and "is this live?". |
| Undo                      | 2     | Editor undo inside the rich text only. No way to throw away an edit, no undo for any action.                                                                                                                                    |
| Hosted use                | 0     | See the next section.                                                                                                                                                                                                           |
| Scale                     | 1     | `/tree` reads and parses every file on every request and the UI refetches it after every save. Every save then recompiles the whole tree.                                                                                       |
| Visual design             | 3     | Coherent tokens, careful dark mode, good details. It reads as a well made developer tool, which is the problem: it does not read as a place to write.                                                                           |

### Hosted Studio is not usable today

Three separate failures, any one of which is fatal:

1. **No way to sign in.** Off loopback the API requires a bearer token, and the
   SPA never sends one. A hosted Studio answers every request with 401 and the
   UI has no sign-in screen to recover with.
2. **Saves cannot land.** A save writes a file. On a serverless host the
   filesystem is read-only, so it fails with `CONTENT_TREE_READ_ONLY`. On a
   container it succeeds and the next deploy erases it, because nothing commits
   it anywhere.
3. **The default tier is excluded.** `graft init` scaffolds the static tier.
   `graft studio` requires `DATABASE_URL` and refuses to start without it, so
   a fresh project has no Studio at all.

### Graded against emil-design-eng and make-interfaces-feel-better

The craft layer is better than the product layer. Motion already follows most
of the rules: no `transition: all`, no `ease-in`, nothing over 300ms, a shared
`--ease-out`, `--press-scale` on pressables, popovers scale from
`var(--transform-origin)`, hover gated behind `(hover: hover)` in 23 places, a
reduced-motion block, antialiased text, `tabular-nums` on counts, balanced
headings. Grade: **craft 4/5, product 1.5/5.** The findings that remain are the
ones that cost an editor something (make-interfaces-feel-better, `full` mode):

| Severity | Location                       | Before                                                                              | After                                                                                                                                                                                      | Why                                                                                                                    |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| HIGH     | `ui/views/collections.tsx:146` | `toast.success("Saved")` after every autosave, roughly once per pause in typing     | Save state lives in one place in the document header (a quiet "Saved" that crossfades from "Saving"), toasts only for failures and for actions the person took (publish, delete with Undo) | Motion restraint: a notification on a high-frequency event repeats its attention cost hundreds of times a session      |
| HIGH     | `ui/styles/parts.css:448`      | Save state is 10px uppercase mono, faint, in a corner                               | Sentence case at UI size with a state dot, beside the Publish control                                                                                                                      | Motion is never the only channel and status must be legible: "is my work safe" is the editor's most important question |
| MEDIUM   | `ui/styles/parts.css:286`      | Field labels are mono `text-xs` raw keys (`TITLE`, `priceCents`) with type chips    | Sans, sentence case labels from the schema (`label`, else humanised key), description as help text, "Optional" in place of type chips                                                      | better-typography: mono caps are for code and tags, not for reading a form                                             |
| MEDIUM   | `ui/styles/studio.css:339`     | Sidebar collapse transitions `width` and `padding`                                  | Collapse without animation (it is a frequent toggle), or translate a fixed-width panel                                                                                                     | Only animate transform and opacity; layout transitions repaint the whole shell every frame                             |
| MEDIUM   | `ui/styles/parts.css:224`      | Page settings is a bordered, sunken card nested inside the bordered, shadowed sheet | Fields sit directly on the sheet in labelled groups; one surface per level                                                                                                                 | Shadows for elevation, borders for structure: a box inside a box reads as a debug panel                                |
| MEDIUM   | `ui/views/overview.tsx`        | Compilations card draws one full-width bar for a single run                         | Overview becomes "Recent edits" and "Waiting to publish"; compilation history moves under Developer                                                                                        | A chart with one datum is decoration, and the wrong decoration for an editor's home                                    |
| LOW      | `ui/styles/studio.css:194`     | `.icon-btn` relies on content size, about 28px                                      | 32px box with a pseudo-element extending the hit area to 40px                                                                                                                              | Minimum hit area in dense desktop UI                                                                                   |

Considered and rejected: replacing the OKLCH palette (it is generated and
APCA-checked, and better-colors would only re-derive it); adding a motion
library (CSS transitions cover every planned motion and stay off the main
thread); staggering list rows on load (lists are high-frequency surfaces).

### What is good and stays

The three-layer token system and its test. Milkdown and the fidelity gate.
`composeDocument` preserving frontmatter bytes. The careful autosave guards
(edit intent, no-op writes, identity from the loaded snapshot). The route
table with a required `scope` column. Owned component declarations. The
Changes drawer's discipline about only committing what it showed. These are
the foundations the rest builds on, not things to replace.

## Principles for v2

1. **Editor language, everywhere an editor looks.** Documents, not files.
   Draft and Published, not dirty and committed. Publish, not commit and push.
   Field labels, not keys. "This field needs a price", not a Zod issue path.
   Developer concepts (index state, compilations, branches, raw source) stay
   available, one level down, under Developer.
2. **One write path, two destinations.** A save is a save. Where the bytes
   land (a file in a checkout, or a commit on a draft branch on GitHub) is the
   job of a `ContentStore`, chosen when the Studio is mounted. Nothing above
   the store knows which one it has.
3. **Git stays the truth, including for drafts.** Drafts are commits on a
   branch, not rows in a table the Studio invented. An agent with repository
   access can read, review or finish an editor's draft with plain git.
4. **Parity is a property of the store, not of the Studio.** MCP and the CLI
   use the same store, so a hosted MCP `write_content` lands as the same kind
   of draft commit a hosted Studio save does.
5. **Scale is designed for, not hoped for.** Lists are paged and filtered on
   the server, parses are cached by content version, and a save does not
   re-read thousands of files.

## Hosted writes: architecture

### The store

`ContentStore` lives in `@usegraft/compiler`, next to `writeDocumentFile` and
`composeDocument`, because that package already owns the authored-content
tree and is the one both Studio and MCP depend on. No new package (a new
`@usegraft/*` needs a manual first publish, see CONVENTIONS).

```ts
interface ContentStore {
  kind: "filesystem" | "github";
  read(path, actor): Promise<{ raw: string; version: string } | null>;
  write(path, raw, { actor, baseVersion }): Promise<{ version: string }>;
  remove(path, { actor, baseVersion }): Promise<void>;
  drafts?: DraftWorkflow; // changes, diff, publish, discard
}
```

Paths are relative to the content directory. `version` is an opaque content
version: a git blob SHA on GitHub, a hash of the bytes on disk. Every write
carries the version the editor loaded, and the store refuses the write with
`CONTENT_CONFLICT` when the current version differs. That one rule covers a
second browser tab, a second editor, and an agent editing the same file over
MCP while a person has it open, which is a real case for an agent-native CMS.

**FilesystemStore** is today's behaviour: write the file, then the caller
recompiles. Its draft workflow is local git, which already exists in
`packages/studio/src/git.ts`: changes are `git status`, publish is
`git commit` of the selected paths, discard is `git restore` (or deleting a
new, untracked file). Locally "publish" is named "Commit", because that is
what it is and the person running a local Studio usually knows it.

**GitHubStore** writes through the GitHub REST API. Nothing touches the local
filesystem, so it works on a read-only serverless filesystem by construction.

### Drafts are a branch per editor

Each editor gets one draft branch, `graft-studio/<editor>`, created from the
production branch on their first save.

- **Save** appends a commit to the editor's draft branch: tree from the draft
  head plus the changed file, then a fast-forward ref update. Fast-forward
  only (no force) is the compare-and-swap: if two tabs save at once, one ref
  update fails and is retried on the new head instead of silently dropping
  the other tab's file.
- **Changes (N)** is the set of content paths that differ between the draft
  branch and the production branch, computed with the compare API and then
  filtered to paths whose blobs actually differ (so a draft that was published
  by a squash merge shows nothing, as it should).
- **Read** for editing comes from the draft branch head, or the production
  branch when the editor has no draft. Never from the deployed checkout, which
  can be minutes stale after a publish. Editing a stale copy and publishing it
  would silently revert someone else's change.
- **Lists** come from the deployed checkout (fast, local, cached by mtime)
  overlaid with the files that differ between the deployed commit and the
  editor's draft. The deployed commit is read from the host's environment
  (`VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA`, `GRAFT_DEPLOYED_SHA`) or the local
  `.git`. So the list is current for everything the editor touched or
  published, at the cost of one compare call, not one call per document.

### Publish: commit or pull request

Configured per mount (`GRAFT_STUDIO_PUBLISH=commit|pull-request`), and per
person: a principal without the new `studio:publish` scope always publishes
as a pull request, whatever the site setting. That gives teams the familiar
split of contributors (submit for review) and editors (publish).

**Direct publish** builds one commit on the production branch, not a merge of
the draft history:

1. Read the production head `H` and the merge base `B` of draft and `H`.
2. `mine` = selected paths changed on the draft since `B`.
   `theirs` = paths changed on production since `B`.
3. A conflict is a path in both whose production blob differs from the draft
   blob. Conflicts are refused with `CONTENT_CONFLICT` naming the documents;
   the editor chooses per document: keep mine, or take the published version
   (which discards that path from the draft).
4. Create a tree on `H`'s tree with only the selected paths, a commit with
   parent `H` authored as the editor, and fast-forward production. If
   production moved in between, retry from step 1 once.
5. Rebuild the draft branch on the new production head with the paths that
   were not published, or delete it when nothing is left.

Squashing on publish keeps production history readable: one commit per
publish, authored by the person, with their message. The draft branch's
autosave commits are scratch and never reach production.

**Pull request publish** does steps 1 to 4 against a new branch
`graft-studio/review/<editor>-<id>` instead of production, opens a PR, and
removes the paths from the draft. The Studio lists open review PRs as
"In review" with a link. Merge conflicts in review are GitHub's to show.

### Credentials: GitHub App, or a token

Both, behind one `GitHubAuth` interface that returns a token for a request.

- **GitHub App** (recommended for teams): `GRAFT_GITHUB_APP_ID`,
  `GRAFT_GITHUB_APP_PRIVATE_KEY`, optional `GRAFT_GITHUB_APP_INSTALLATION_ID`.
  The Studio signs an RS256 JWT with `node:crypto` (no dependency), exchanges
  it for an installation token and caches it until five minutes before
  expiry. Commits are attributed to the editor as author; the app is the
  committer. Access is limited to the repositories the app is installed on,
  and nothing is tied to one employee's account.
- **Fine-grained token** (simplest): `GRAFT_GITHUB_TOKEN` with Contents and
  Pull requests read/write on one repository. One variable to set up.

The repository is `GRAFT_GITHUB_REPO=owner/name`, production branch
`GRAFT_GITHUB_BRANCH` (default `main`), and the content directory's path in
the repository `GRAFT_GITHUB_CONTENT_PATH` (default: the content directory
relative to the project root, which is `content` for a standard layout).

### Editors sign in

Hosted Studio gets a session layer in `@usegraft/studio`: an HMAC-signed,
`HttpOnly`, `SameSite=Lax`, `Secure` cookie, signed with
`GRAFT_STUDIO_SECRET`. Stateless, so it works on serverless without a session
table. Two ways in:

- **Sign in with GitHub** (OAuth app: `GRAFT_GITHUB_CLIENT_ID`,
  `GRAFT_GITHUB_CLIENT_SECRET`). Access is granted to people on
  `GRAFT_STUDIO_EDITORS` (logins or emails, each optionally `=role`), or, when
  that is unset, to anyone with write access to the repository, checked with
  the store's credentials. The commit author is the person's GitHub identity.
- **Invite links** for people with no GitHub account:
  `graft studio invite ana@shop.com --role editor` prints a signed link that
  expires in seven days. No email service is needed; the admin sends it.
  The commit author is the invited name and email.

Roles map to the existing scopes, plus one new one:

| Role          | Scopes                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| `viewer`      | `studio:read`                                                           |
| `contributor` | `studio:read`, `studio:write` (drafts; publishing opens a pull request) |
| `editor`      | contributor + `studio:publish`                                          |
| `admin`       | editor + `approvals:decide`                                             |

Bearer tokens keep working beside sessions, so agents and scripts are
unaffected. CSRF protection is the existing same-origin plus JSON content type
check, which holds for cookies as well as it did for bearer tokens.

Trade-offs taken knowingly: invite links are bearer credentials until they
expire, and a session cannot be revoked one at a time. Rotating
`GRAFT_STUDIO_SECRET` revokes every session and link at once. A session table
(Postgres tier) can add per-session revocation later without changing the
cookie shape.

### Which tier needs what

| Capability                               | Static tier                     | Postgres tier |
| ---------------------------------------- | ------------------------------- | ------------- |
| Local Studio, edit and commit            | unit 7 (today: no)              | yes           |
| Hosted Studio, GitHub drafts and publish | unit 7                          | yes           |
| Approvals, compilations, branches views  | no (they are Postgres features) | yes           |

The GitHub store itself has no database dependency. The Studio still takes a
`Database` for its developer views, which is why the static tier is its own
unit rather than part of this one.

### What happens after publish

Direct publish moves the production branch. The host's normal git deploy
(Vercel, Netlify, a CI job running `graft compile`) rebuilds and recompiles,
exactly as for a developer's push. The Studio does not compile into the
production index from a draft, because that would publish unreviewed content
to the live site. Until the redeploy lands, the Studio shows the published
version from GitHub, not the stale checkout.

## E-commerce gaps

Measured against a catalog of a few thousand products with variants,
categories and galleries:

1. **Field types.** No select (a product `status`, a docs `section`), no
   reference to another document (product to category, related products).
   Constraints exist on fields (`min`, `max`, `int`, `maxLength`, `pattern`,
   `maxItems`) but are not in the descriptor, so neither the form nor an agent
   can see them. No human label for a field.
2. **Structured values.** Arrays of objects (variants with SKU, price, stock),
   arrays of assets (galleries), arrays of strings (tags) are all "Edit in Raw
   MDX".
3. **Lists.** Need a table per collection with chosen columns, search, sort,
   filters on select, boolean and reference fields, server-side paging, and
   bulk selection with publish, discard and delete.
4. **Create and manage.** New, duplicate, delete, and a slug derived from the
   title for a new document.
5. **Validation.** Client-side checks from the descriptor, in words, on the
   field; server issues mapped back to the same fields.
6. **Images.** Upload from the Studio (presigned PUT straight to the asset
   store, so a large file never passes through a serverless function).
7. **Performance.** No full-tree read per request; no full recompile per save
   in local mode (projection of the one changed document).
8. **Referential integrity.** A reference to a deleted category should fail
   compile with a message naming both documents. Later unit.

## Units, in order

Each is code, tests and one conventional commit, shippable on its own.

1. **Editor field metadata.** `label` on every field; `field.select`,
   `field.reference`; constraints in `FieldDescriptor`. MCP `describe_schema`
   gains the same detail for free. (`core`, `contracts`)
2. **ContentStore.** Interface, filesystem store, GitHub store with drafts,
   publish (commit or PR), discard, conflict detection, App and token auth.
   Tested against an in-memory GitHub that implements the REST endpoints used.
   (`compiler`)
3. **Editor sessions.** Signed cookie sessions, GitHub sign-in, invite links,
   roles, `studio:publish`. `graft studio invite`. (`studio`, `cli`)
4. **Studio content API on the store.** Catalog listing (paged, filtered,
   sorted, cached), create, delete, versioned saves, changes, diff, publish,
   discard, workspace info. `graft serve --studio` mounts the GitHub store
   when configured. MCP `write_content` writes through the same store, and
   MCP gains `list_changes`, `publish_changes`, `discard_changes` when a
   draft-capable store is mounted. (`studio`, `cli`, `mcp`) Shipped as
   `list_drafts`, `publish_drafts` and `discard_drafts`, named after what an
   editor calls them.
5. **The editor UI.** Editor-first shell, collection tables, document editor
   with labelled fields and structured editors (groups, repeatable groups,
   tags, galleries, reference picker), inline validation, publish sheet with
   per-document diff, undo for actions, discard, sign-in screen. Developer
   views kept under Developer. (`studio`)
6. **Deploy story.** `examples/shop` (a product catalog seeded at scale),
   a hosting page in the docs, a Studio section in `deploy/README.md`, and an
   end-to-end check
   that a hosted save and publish produce commits on a repository.
7. **Studio on the static tier.** Optional `db`; developer views degrade to
   "needs Postgres" panels; state comes from the SQLite artifact.
8. **Incremental projection on save**, image upload, per-document history
   with restore (git log of one path), referential integrity in compile, bulk
   field edits.

## Verification plan

- Unit tests for every store operation against the in-memory GitHub,
  including the races: concurrent saves, production moving during publish,
  squash-merged drafts, deleted files, conflicts.
- Session codec tests: tampering, expiry, wrong secret, role mapping.
- A real-repository test for the filesystem store's git workflow, as `git.ts`
  already does.
- End to end: `graft serve --studio` with the content directory read-only and
  the GitHub store pointed at a GitHub-compatible server, driven by a browser:
  sign in with an invite link, edit a product, publish, and assert the commit
  on the production branch with the editor as author. Against real GitHub
  this is a documented manual step, because the cloud session that built this
  has no GitHub credentials to give the Studio.

## Progress

| Unit                                           | State   | Commit                                                                     |
| ---------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| 1. Editor field metadata                       | shipped | `feat(core): select and reference fields…`                                 |
| 2. ContentStore                                | shipped | `feat(compiler): content store with GitHub drafts…`                        |
| 3. Editor sessions                             | shipped | `feat(studio): sign in to a hosted Studio…`                                |
| 4. Studio content API on the store, MCP parity | shipped | `feat(studio): editor API…`, `feat(mcp): write through the content store…` |
| 5. The editor UI                               | shipped | `feat(studio): an editor for people…`                                      |
| 6. Deploy story                                | shipped | `docs(studio): host Studio for a team…`                                    |
| 7. Studio on the static tier                   | next    |                                                                            |
| 8. Incremental projection and the rest         | next    |                                                                            |

### What verification found

- **A real bug outside Studio.** The Node adapter in `graft serve` folded
  several `Set-Cookie` headers into one, so a hosted sign-in lost its session
  cookie. Fixed with `Headers.getSetCookie()` and a test, in its own commit.
- **End to end, hosted.** `examples/shop/scripts/e2e-hosted.mjs` boots
  `graft serve --studio` with the content directory read-only, against the
  in-memory GitHub served over HTTP. Every step holds: a signed-out request
  is refused, an invite link sets a session, a save is a commit on
  `graft-studio/drafts/<editor>` authored by the editor, the deployed files
  and production are untouched, a stale save gets 409 `CONTENT_CONFLICT`,
  publish lands one commit on main by the editor, the draft branch holds no
  changes afterwards (it is emptied by a fast-forward, not deleted, because a
  delete cannot be made conditional), and the list shows the published price
  before any redeploy.
- **In a browser.** Hosted as a contributor: sign-in screen, "Submit for
  review", the publish sheet's field diff ("Name: Clay Cashmere Beanie →
  Clay Cashmere Watch Cap"), and the done state linking the pull request.
  Locally: edit, autosave, field diff, commit; create with validation;
  dark mode.
- **Against real GitHub** this remains a manual step: point `GRAFT_GITHUB_*`
  at a test repository and walk "Check it works" in the hosting guide. The
  session that built this had no credentials to give a Studio.

### Scale, 2,000 products

Measured on `node scripts/seed.mjs --count 2000`, local Studio:

| Operation                    | Time        |
| ---------------------------- | ----------- |
| `graft compile`              | 2.3 s       |
| `/entries`, first page, cold | 226 ms      |
| `/entries`, first page, warm | about 46 ms |
| Search                       | about 40 ms |
| Filter and sort              | about 36 ms |
| Local save                   | 1.3 s       |

Lists are fast because `DiskCatalog` caches parsed entries by mtime and size
and the query runs on the server. A local save is slow because it recompiles
the whole tree. `projectBranchContent` in `@usegraft/db` diffs the full branch
and soft-deletes rows it was not given, so projecting one document needs a
new function rather than a smaller input. That is the first item of unit 8.
Hosted saves do not compile at all.

### Debt left on purpose

- Done in this PR: the `/document` routes, superseded by `/entry`, were
  removed once `feat/content-change-refresh` (#56) merged; their save-path,
  fidelity and refresh tests now run against `/entry`.
- Rules for the old shell remain in `studio.css` and `parts.css`.
- The editor chunk (Milkdown and CodeMirror) is 2.7 MB and should load only
  when an entry opens.
