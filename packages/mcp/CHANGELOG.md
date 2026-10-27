# @usegraft/mcp

## 1.0.0-beta.9

### Minor Changes

- 1a627ef: Read and write content from the terminal. The new commands run the same MCP
  tools an agent calls, in the CLI's own process, so they check the schema,
  compile, and file approvals exactly as the agent's call would. With `--json`,
  each prints exactly what the tool returns.

  | Command                                                    | Tool                                                  |
  | ---------------------------------------------------------- | ----------------------------------------------------- |
  | `graft content list [collection]`                          | `list_collections`, `list_content`                    |
  | `graft content get <collection>/<slug>`                    | `get_content`, printed as the MDX file                |
  | `graft content search <query>`                             | `search_content`                                      |
  | `graft content write <collection>/<slug>`                  | `write_content`, from `--file` or `--data`            |
  | `graft content set <collection> <slug...> --field --value` | `write_content` for each document                     |
  | `graft content delete <collection>/<slug>`                 | `delete_content`                                      |
  | `graft drafts`, `drafts publish`, `drafts discard`         | `list_drafts`, `publish_drafts`, `discard_drafts`     |
  | `graft schema`                                             | `describe_schema`                                     |
  | `graft fn`, `fn describe`, `fn run`                        | `list_functions`, `describe_function`, `run_function` |
  | `graft explain <code>`                                     | `explain_error`                                       |
  | `graft mcp tools`, `graft mcp call <tool>`                 | any tool, by name                                     |

  `graft content get pages/home > home.mdx` and
  `graft content write pages/home --file home.mdx` round-trip a document. A
  delete, or a destructive function, exits 3 and its `fix` names the exact
  command to repeat with `--approval <id>` once a person has approved it.

  **BREAKING:** `graft content` now lists the documents from the content files
  (or from the database, where content is kept there) instead of reading the
  Postgres index. It works on the static engine with no `DATABASE_URL`, and
  `--json` prints `{ branch, collections: [{ collection, documents }] }`.

  `@usegraft/mcp` exports the client the CLI uses: `connectInProcess(server)`
  and `connectClient(transport)` return a `ToolClient` that calls tools by name
  and rejects with the GraftError a tool failed with
  (`toolResultToGraftError`).

- acb4a84: Work with a hosted site from the terminal. `graft login <url>` checks a token
  made in Studio under Developer, Agents, and saves it in
  `~/.config/graft/hosts.json` (mode 600). The token comes from stdin
  (`--with-token`) or a prompt that does not echo, never from an argument.

  ```sh
  printf %s "$TOKEN" | graft login https://cms.example.com --with-token
  graft content list --remote
  graft api entries -f collection=posts --paginate
  ```

  - `--remote` on `graft content`, `graft drafts`, `graft schema`, `graft fn`,
    `graft mcp tools`, `graft mcp call` and `graft approvals` runs the same MCP
    tools on the site's `/api/mcp`. `GRAFT_URL` and `GRAFT_TOKEN` in the
    environment do the same without the flag, and `--local` overrides them.
    Neither is read from `.env`.
  - `graft api <path>` calls any Studio API route with the saved token: `-X`,
    `-f`/`-F` fields, `-H`, `--input`, `--include` and `--paginate`. It reaches
    only the logged-in site, follows no redirects, and needs `--yes` for
    `-X DELETE`.
  - `graft auth status` checks each saved token against its site,
    `graft auth token` prints one for piping, and `graft logout` forgets one.
  - A refused token exits 4 with `TOKEN_INVALID`; an unreachable site is the new
    `REMOTE_UNREACHABLE`. No token can approve an action, so a remote delete
    still exits 3 until a person approves it.

  `@usegraft/mcp` adds `connectRemote({ origin, token })`, a `ToolClient` over
  HTTP to a hosted `/api/mcp`.

### Patch Changes

- 9a17a95: **BREAKING:** `graft` exits with a code that says what kind of failure it was,
  and refuses a flag the command does not take.

  Before, every failure exited 1, and a flag meant for another command was
  silently ignored: `graft init --apply` succeeded and did nothing, which is how
  a dry run gets mistaken for a real one. Now:

  | Exit code | Meaning                                                                                            |
  | --------- | -------------------------------------------------------------------------------------------------- |
  | 0         | It worked                                                                                          |
  | 1         | It failed; the error says why and what to do                                                       |
  | 2         | The command was called wrong: an unknown command or flag, or a missing argument. Nothing ran       |
  | 3         | A person has to approve the action first (`DESTRUCTIVE_OP_REQUIRES_APPROVAL`)                      |
  | 4         | The credential is missing, wrong, or lacks the access this needs (`UNAUTHORIZED`, `TOKEN_INVALID`) |

  A script that checks for exit code 1 after a usage mistake must check for 2.
  An unknown command no longer prints the whole help on stdout; it prints the
  closest command on stderr:

  ```text
  graft: unknown command "complie".
  Did you mean `graft compile`? Run `graft --help` to list the commands.
  ```

  Every command that prints data now takes `--json`: `init`, `doctor`, `add`,
  `compile`, `check`, `content`, `compilations`, `asset put`, `studio invite`,
  `content import`, `pull`, `push`, `mirror`, `db migrate`, `migrate`,
  `harden`, `approvals`, `approve`, `deny`, `branch`, `branch create`,
  `branch drop`, `merge`, `ci changes` and `ci skip-build`. It prints one JSON
  object on stdout and sends every message to stderr. The object is indented on
  a terminal and on one line when piped, so `graft doctor --json` piped to a
  file is now one line. A command run with `--json` that fails prints one line
  of JSON on stderr: `{"error", "message", "fix", "details"}`, the shape every
  Graft error has. `graft check --json` lists each problem with its code and
  fix.

  Also new:

  - `graft help <command>` and `graft help <topic>` (`exit-codes`, `json`,
    `environment`).
  - `graft commands --json` describes every command, its arguments and flags,
    so an agent can learn the CLI in one call.
  - `graft add` with no item lists the primitives you can add, instead of
    failing with `REGISTRY_ITEM_NOT_FOUND`. `graft db --help`, `graft ci --help`
    and the other families print help for every member.
  - `--no-input` on `graft create` and `graft db claim`, or
    `GRAFT_PROMPT_DISABLED=1` for every command, never asks a question.
  - Color follows `NO_COLOR`, `FORCE_COLOR`, `CLICOLOR`, `CLICOLOR_FORCE` and
    `TERM=dumb`.
  - An unexpected error prints one line instead of a stack trace;
    `GRAFT_DEBUG=1` prints the trace.
  - The CLI turns on Node's compile cache, which makes `graft check` about 8%
    faster on a 48-document project.

  Two error codes are added for these, with entries in the error reference and
  in `explain_error`: `USAGE_INVALID` and `INTERNAL_ERROR`.

- 42213aa: Static projects no longer load the Postgres code. `@usegraft/db/static` is a new entry with the SQLite content index, the content diff, the search query check and branch scopes, and no drizzle-orm or Postgres driver behind it. Core, the compiler and the MCP server load the rest of `@usegraft/db` only inside the functions that talk to Postgres. On a 50-page static site, `graft content get` went from about 950 ms to about 480 ms. Everything in `@usegraft/db/static` is still exported from `@usegraft/db`.
- 1deb1a7: **BREAKING:** `@usegraft/sdk-next` no longer supports Next.js 14. Its peer range is `next@^15.0.0 || ^16.0.0`, and CI no longer builds a Next.js 14 app. Next.js 14 gets no security fixes, and its last release, 14.2.35, has two critical remote code execution advisories that will not be fixed on 14.

  The adapter still runs on 14.2, so a project that cannot upgrade yet keeps working. pnpm and bun print a peer warning on install, and npm refuses unless you pass `--legacy-peer-deps`. `withGraft` now says that 14 is not supported and links to "Run Graft on Next.js 14" in the Next.js guide, which lists what differs on 14. Upgrade to 15.5.24 or 16.3.3 or later.

  The MCP `list_packages` tool says `@usegraft/sdk-next` is for Next.js 15 or 16.

- 3374aab: These packages now need zod 4.6.7 or newer. Earlier 4.x releases can run out of memory while validating a very large array or set that has a size limit.
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
  - @usegraft/registry@1.0.0-beta.9
  - @usegraft/assets@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

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

- 5553879: Requires `@modelcontextprotocol/sdk` 1.31 or newer. Older versions could send an OAuth client's credentials to the wrong authorization server, and pulled in `proxy-addr`, `hono` and `ip-address` versions with known advisories.
- c9868b0: `tools/list` no longer fails with "Cannot read properties of undefined (reading 'push')" when the MCP SDK resolves an older zod than Graft's. The SDK takes any zod from 3.25 on, so a project whose own dependencies bring zod 4.2 to 4.4 handed the SDK a converter that crashed on Graft's schemas. Calling a tool by name still worked, but standard clients list tools first, so none of them could connect. The listing is now converted with the zod that built the schemas, and is otherwise the SDK's own, field for field.

  `serverInfo` reports the Graft release instead of `0.0.0`.

  Token messages speak to whoever holds the token. A revoked or unknown Studio token is told to get a live one from Developer, Agents, not to configure `createActorResolver`. A token missing a scope is told which access level carries it. An anonymous caller is told where tokens come from.

  `graft serve` beyond loopback no longer warns that MCP will refuse every caller: tokens made in Studio always work. It now says how callers get in.

  On `graft studio`, the Agents page no longer shows an MCP endpoint on this computer, which answered 404. It shows `npx graft mcp` for an agent on this machine, and `/api/mcp` wherever `graft serve` runs.

- 41c371f: An agent's `write_content` and `delete_content` now update the index for the
  file they wrote, instead of recompiling the whole content tree, as a Studio
  save does. On a 2,000-product catalog a `write_content` call took about 1.5
  seconds and now takes about 110 milliseconds. The result's `changes` lists
  that one document. The static index is still rebuilt whole, and content kept
  in the database is unchanged.
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

- d06bbc3: `@usegraft/sdk-next` runs on Next.js 14.2 and later, and in the Pages Router as well as the App Router. The peer ranges are now `next@^14.2.0 || ^15.0.0 || ^16.0.0` and `react@^18.2.0 || ^19.0.0`.

  - **The Pages Router.** Read in `getStaticProps` or `getServerSideProps` as before. `prepareMdx(body)` compiles a body there, with the same trust rule as `MdxBody`, and `MdxContent` renders the result in the server render and in the browser. It comes from a new entry, `@usegraft/sdk-next/mdx`, that carries no server code. A body that uses `import` is refused with `INPUT_VALIDATION_FAILED`, since the browser has no bundler to resolve it.
  - **React 18.** `createGraft` uses `React.cache` where React has it, and reads straight through where it does not, as in the Pages Router on Next.js 14.
  - **Next.js 14.** `withGraft` writes `experimental.serverComponentsExternalPackages` there, the name 14 reads, and `serverExternalPackages` on 15 and later. The adapter imports `next/cache.js`, which Node's own loader can resolve when the Pages Router loads it unbundled.
  - **Advisories.** Releases with open critical Next.js advisories are no longer refused at install. `withGraft` prints one warning naming the release to upgrade to: any 14, 15 before 15.5.24, or 16 before 16.3.3. Next.js 14 gets no more security fixes. Its last release, 14.2.35, is affected by 23 published advisories, two of them critical remote code execution, and each is fixed only in 15 and 16. Support for 14.2 is there so you can adopt Graft before you upgrade.

  CI now builds and serves a real Next.js 14.2.35 app beside 15 and 16, and on each checks a Pages Router page and that none of the scripts it sends to the browser carries the database, the index or the MDX compiler. The Next.js guide has a version table and a section on the Pages Router.

- 9571702: Studio's Publish button no longer says "Publish" for a moment before it says Commit or Submit for review. It now reads what it does from the workspace, which answers at once, instead of guessing until the drafts load.

  A collection's search, filters and sort are kept in the address, so a reload, the back button or a shared link shows the same rows. Its count, and Home's, no longer include entries deleted in a draft: they stay listed as Deleted until the deletion is published.

  Home's recent activity folds a run of the same person changing the same entries into one row ("Kyrus, 3 times"). Health and Settings read the content again after every save, publish, discard or delete, so their counts are never from before the last change. Studio has a favicon, so browsers stop asking the server for `/favicon.ico`.

  An agent's `publish_drafts` that commits to the production branch on GitHub now calls the site's deploy hooks under `graft serve`, as a database publish does. `createGraftMcp` takes an `onPublished` callback for this. A hook that fails never fails the publish.

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
  - @usegraft/registry@1.0.0-beta.8

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

### Patch Changes

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
  - @usegraft/registry@1.0.0-beta.7
  - @usegraft/assets@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- 2386e74: A save to a GitHub draft can no longer be lost while the draft is being emptied. Publishing everything or discarding the last change used to read the draft branch and then delete it, and a save that landed in between was deleted with it after reporting success. The draft is now emptied with a fast-forward that fails if the branch moved, so the branch stays, holding no changes, and the next save reuses it.

  Invite-link editors get new draft branch names. Their key joins the hash with `--`, which a GitHub login cannot produce, so a login shaped like an email's key (`ana-lima-shop-test-0123456789`) no longer shares that person's draft. A draft saved under the old name before upgrading stays on GitHub as a branch: publish or discard it first, or merge it by hand.

- 2386e74: `explain_error` for `REMOTE_STORE_FAILED` no longer promises that a failed save did not happen. A refusal means that one request was not applied, but a publish can move production before a later step is refused, and a network error can arrive after GitHub applied the request, so agents are told to check the branches before retrying. A 404 now also names its other cause: a private repository the token or GitHub App cannot see.
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
  - @usegraft/registry@1.0.0-beta.6
  - @usegraft/assets@1.0.0-beta.6

## 1.0.0-beta.5

### Minor Changes

- ab7cca3: Add the content store: where authored content is read from and written to, behind one interface. `FilesystemStore` is today's behaviour. `GitHubStore` writes through the GitHub REST API, so a hosted surface on a read-only filesystem can save: each editor drafts on their own branch, and publishing lands one commit on the production branch authored by the editor, or opens a pull request. Every write can carry the version it was read at and is refused with the new `CONTENT_CONFLICT` code when the document changed underneath it, which covers a second tab or an agent writing under the same identity. Editors draft apart, so between two editors the guard is at publish: it refuses to overwrite a document production changed since the draft began until someone chooses to keep the draft or take the published version. Credentials are a fine-grained token (`GRAFT_GITHUB_TOKEN`) or a GitHub App (`GRAFT_GITHUB_APP_ID`, `GRAFT_GITHUB_APP_PRIVATE_KEY`); `githubStoreFromEnv` reads the configuration. GitHub failures surface as `REMOTE_STORE_FAILED`: a refusal carries GitHub's own message and status, and an unreachable GitHub says so. `@usegraft/compiler/testing` exports an in-memory GitHub for tests.
- ab7cca3: MCP writes through the content store. On a `graft serve` that writes to GitHub (`GRAFT_GITHUB_REPO` set), `write_content` and `delete_content` commit to the connection's own draft branch instead of the read-only files, and three tools appear: `list_drafts`, `publish_drafts` (a pull request, or a commit to the production branch with the new `content:publish` scope) and `discard_drafts`. Agents and Studio editors share one draft model.

### Patch Changes

- Updated dependencies [ab7cca3]
- Updated dependencies [ab7cca3]
  - @usegraft/compiler@1.0.0-beta.5
  - @usegraft/contracts@1.0.0-beta.5
  - @usegraft/core@1.0.0-beta.5
  - @usegraft/db@1.0.0-beta.5
  - @usegraft/mdx-safety@1.0.0-beta.5
  - @usegraft/registry@1.0.0-beta.5
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
  - @usegraft/registry@1.0.0-beta.4
  - @usegraft/assets@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- 56c0957: `graft asset put` refuses a key that already holds a file, like `put_asset`.

  The MCP `put_asset` tool has refused a taken key with `ASSET_EXISTS` unless the
  caller passed `overwrite: true`. The CLI did not check: it replaced whatever was
  stored under the key. The store keeps no version history, so the old file was
  gone, and every page pointing at the key showed the new one.

  The CLI now checks first and fails with the same `ASSET_EXISTS` error. Pass
  `--overwrite` to replace the file on purpose.

  Both also make the upload itself conditional. `Storage.put` from
  `@usegraft/assets` takes `{ ifAbsent: true }`, which sends
  `If-None-Match: *`, and throws `AssetKeyTakenError` when the store answers 412. So the store refuses a key that a concurrent upload took between the check
  and the write, or that a credential allowed to upload but not read cannot see.
  A store that ignores the header writes as before, behind the existence check.

  **Breaking:** a script that re-uploads to the same key now fails until it adds
  `--overwrite` or picks a new key.

- f92b97c: Clearer wording for two error explanations. `NEEDS_DATABASE` now says the project runs on the static storage engine and the feature needs the Postgres engine, instead of "static index mode" and "Postgres-tier". The registry entry now says "core registry" instead of "Tier-1 registry". `@usegraft/tokens` adds a `--measure` token for the reading width of prose. It also defines `--space-5`, which eight declarations already used while it was undefined, so callouts and other spaced elements lost their padding. Callouts get their own note and warning hues instead of reusing the accent, and `--n-10` names pure white for text on the primary color in dark mode.
- f92b97c: `run_function` now sets `openWorldHint: true`. It runs the project's own
  functions, and a function can call any external service, so it cannot promise
  the closed world every other tool does. Every other tool keeps
  `openWorldHint: false`.
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
  - @usegraft/registry@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- Updated dependencies [98ff4ba]
  - @usegraft/assets@1.0.0-beta.2
  - @usegraft/compiler@1.0.0-beta.2
  - @usegraft/contracts@1.0.0-beta.2
  - @usegraft/core@1.0.0-beta.2
  - @usegraft/db@1.0.0-beta.2
  - @usegraft/mdx-safety@1.0.0-beta.2
  - @usegraft/registry@1.0.0-beta.2

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
  - @usegraft/registry@1.0.0-beta.1
  - @usegraft/assets@1.0.0-beta.1
  - @usegraft/compiler@1.0.0-beta.1
  - @usegraft/db@1.0.0-beta.1
  - @usegraft/mdx-safety@1.0.0-beta.1

## 1.0.0-beta.0

### Minor Changes

- 76baf51: Add `list_packages`, so an agent can answer "what do I install?"

  The tool surface could already introspect a project that exists — its
  collections, functions, errors, owned primitives. Nothing said which
  `@usegraft/*` package to reach for, so a user on SvelteKit could only be told
  about `@usegraft/sdk-sveltekit` if the model happened to have read the docs.
  That is the first question anyone asks, and it was the one question with no
  surface.

  Filter by `framework` and you get that adapter plus the packages every project
  needs, never a competing one. Filter by `tier` and a static project is never
  told to install something that cannot work without Postgres. It is registered
  on the public documentation mount too: it carries nothing about the project,
  only which of Graft's own packages exists, which is documentation in the
  plainest sense.

  `PACKAGE_KNOWLEDGE` is held in lockstep with what actually ships by a test, the
  same way `ERROR_KNOWLEDGE` is with `ErrorCodes` — a package added without an
  entry is a package no agent will ever suggest. It caught `@usegraft/tokens`
  missing on its first run.

### Patch Changes

- 1139a88: Add a versioned, read-only authored-content HTTP API and a remote
  `ContentIndexReader`. `graft serve` now mounts document reads and search at
  `/api/content/v1`, fixed to the server's resolved branch.
- 18ac061: Refuse elicited approvals over HTTP, and stop a failed prompt breaking the call.

  Three findings from cubic's review of the pull request, all on
  `approvalElicitation`.

  **`createGraftMcpHandler` now throws `CONFIG_INVALID` if given
  `approvalElicitation`.** It was documented as "a remote or public mount must
  never set it" and enforced nowhere. A documented caution is the wrong shape for
  this one, because getting it wrong inverts the gate rather than weakening it:
  over HTTP the client being asked to approve _is_ the agent that made the call,
  while `decider` is configured server-side — so an accepted prompt is
  self-approval recorded under the operator's name. `requested_by_id <>
decided_by` lives in the UPDATE's own `WHERE` precisely so that cannot happen,
  and asking the requester's own client walks around it. `createGraftMcp` (stdio,
  operator at the machine) still accepts it.

  **A failed elicitation falls back instead of failing the tool call.** The
  capability check covered a client that never declared it; a client that declares
  it and then fails the request — older SDK, a schema it will not render, a
  transport that times out with the dialog open — let the error escape as a raw
  `McpError`. It now falls through to the id-and-retry path, the same answer an
  undeclared capability gets. Nothing is decided, so the row stays pending for a
  human to find.

  **The prompt no longer truncates silently.** Inputs were cut at 300 characters
  with an ellipsis; the limit is now 1000 and the message says it truncated, gives
  the full length, and points at `graft approvals`. A consent dialog that shows
  part of what is being consented to without saying so is worse than no preview,
  because the reader believes they have seen the call.

- d3c51d1: Let a local MCP server ask its operator to decide a destructive call in-band,
  instead of failing with an id for them to run `graft approve` on.

  Opt-in and off by default: `approvalElicitation: { decider }` on
  `createGraftMcp`, or `graft mcp --elicit-approvals`, which records the decision
  as the OS user — exactly who `graft approve` records. A remote or public mount
  must never enable it: there is nobody at the other end to ask.

  What changes is how the human is reached. What does not change is anything
  underneath: the decision is still a row in `approvals`, still one-shot, still
  bound to the exact function and canonical input, still stamped with
  `decided_role = current_user`, and still refused by Postgres when the decider is
  the requester. `decider` is configured rather than taken from the connection
  precisely because that predicate lives in the UPDATE's own `WHERE`.

  A client that never declared the elicitation capability falls back to the
  id-and-retry flow. Dismissing the prompt leaves the approval pending — only an
  explicit no records a denial.

  `delete_content`, `run_function` and the DESTRUCTIVE_OP_REQUIRES_APPROVAL
  explanation all now say the in-band path exists, so an agent seeing either
  outcome knows both are ordinary.

- ffd5a07: Add `createDocsMcp` / `createDocsMcpHandler`: a public, read-only documentation
  MCP server, for `/mcp` on a docs domain.

  It follows what docs platforms already publish. Mintlify generates a docs MCP at
  `/mcp` for every site it hosts — public, unauthenticated, strictly read-only,
  offering search plus navigating and reading the docs filesystem. Cloudflare runs
  a documentation server separately from its authenticated API server. Agents
  arrive expecting this shape.

  The surface is `list_collections`, `list_content`, `get_content`,
  `search_content`, `explain_error`, and the document resources. What is missing
  is mostly not about writes: `describe_schema` carries the project's functions,
  `list_registry` its owned primitives, and the branch, compilation and approval
  listings its operations. Those are all reads, which is why "read-only" is the
  wrong test for what belongs on a public endpoint.

  It is a separate factory rather than a flag on `createGraftMcp`, so the
  authenticated endpoint gains no new way to be opened. `DocsMcpOptions` omits
  `functions`, `actor`, storage and approval elicitation outright, and
  `createDocsMcpHandler` has no `allowAnonymous` escape because it has nothing to
  authenticate.

  Internally this splits the content tools into read and write registrations, the
  introspection tools into collection and function halves, and the resources into
  documents and schema. A mount whose whole purpose is public should not be one
  `if` away from `write_content`.

- e36c09b: Declare `outputSchema` on the 16 tools whose answer has a fixed shape, so
  `structuredContent` is a validated contract rather than a convenience.

  The SDK checks every result against the schema before it leaves the server, so
  a tool that quietly changes shape now fails at its own boundary instead of in
  whatever the agent tried to do with the answer. Where a contract already existed
  in `@usegraft/contracts` it is reused rather than restated: `describe_schema`,
  `describe_function` and `describe_item` were already published shapes with a
  drift test, and this attaches them to the wire.

  `run_function` and `delete_content` deliberately keep no schema. Both return
  whatever the project's own function returns, so a declared shape would promise
  nothing and cost a validation pass. They are an explicit exemption in the test
  rather than an omission that looks like an oversight.

- 04f7576: **Security:** `write_content` could write outside `contentDir`.

  The `slug` argument was `z.string()` with no shape constraint, and the path was
  built as `join(contentDir, collection, slug + ".mdx")`. `parseDocument`, which
  runs afterwards, is not a guard against this: it validates
  `basename(sourcePath)`, so a slug of `"../../escaped"` parses as the entirely
  legal slug `"escaped"` while the join walks two directories up. Confirmed by
  running it before the fix — the file landed outside the content tree and the
  call returned success, not an error.

  Any caller holding `content:write` could therefore write an arbitrary file
  anywhere the server process could. That is most of the point of the scope on a
  local stdio server, and not at all the point on an HTTP mount.

  Two independent defences, each verified to hold on its own:

  - `assertSlugShape` rejects a non-kebab-case slug in the handler with
    `INVALID_SLUG` and a `fix`. Deliberately not a `.regex()` on the input
    schema — zod rejects before the tool body runs and the SDK surfaces that as a
    bare protocol error with no `fix`, which is the self-teaching an agent most
    needs when the correct slug is one edit away.
  - `resolveContained` decides where bytes actually land, so the guarantee does
    not rest on the check above still being there.

  `delete_content` gets the same slug check, ahead of `findDoc` and ahead of the
  approval, so a malformed slug never reaches a human as a pending decision.

  The **document resource read** and the **delete** now resolve through
  `resolveContained` too. Those follow a `sourcePath` produced by a directory
  scan, which a caller cannot inject — but the scan lists a symlink like any
  other entry, and following one would serve or unlink a file outside the content
  tree. That matters most on the read, because the read-only documentation server
  is an unauthenticated mount. Raised by cubic on the pull request; the write
  traversal above was found by pulling on it.

- 23b73fa: Add prompts and argument completion.

  Four prompts, each filled in from the live project: `author-document` and
  `plan-migration` carry the collection's actual field list, `revise-document`
  carries the document's resource URI, and `fix-error` resolves the recovery text
  from this build's own error knowledge. A prompt that only said "author a
  document nicely" would be a sentence the user could have typed, and would carry
  no reason to live on the server.

  They also encode the order of operations an agent has no way to infer:
  `write_content` validates before it writes, `write_content` replaces rather than
  patches so untouched frontmatter must come back byte-identical, migrations are
  reviewable commits, and `graft migrate --apply` is the operator's consent to
  propose rather than to run.

  Prompt arguments and resource-template variables autocomplete from what exists:
  collection names, document slugs narrowed to the collection already chosen, and
  error codes matched case-insensitively. Picking a collection that is not
  registered is a mistake the server can prevent rather than diagnose.

- 9859435: Return `resource_link` blocks from the content tools, so an answer that names
  documents also says where they are.

  `list_content`, `get_content`, `search_content` and `write_content` now carry a
  link per document alongside their text. A tool answering "here are eleven
  documents" and leaving the client to reconstruct eleven URIs was asking it to
  know the scheme; a search hit already knows its collection and slug, so the
  link saves a `get_content` round trip to reach the document itself.

  The URI scheme lives in one module now, used by both the links and the resource
  registration. Two spellings of it would be two things to keep in step, and the
  failure would be silent — a link pointing at a URI nothing serves reads as a
  broken client rather than a server that disagrees with itself. The test follows
  a link through `readResource` rather than comparing strings.

  The text block stays first, so a client that ignores links loses nothing, and
  a failure emits no links at all.

- 0db04f7: Serve authored documents and the project schema as MCP resources.

  A tool call is a request to do something; a resource is a thing that exists,
  addressed by URI, which a client can list and attach to a conversation without
  spending a turn deciding to. Graft's documents were reachable only as tool
  output, so attaching one meant an agent calling `get_content` and pasting the
  answer — and they are files with stable paths, the most resource-shaped thing
  in the product.

  URIs are `graft://<branch>/<collection>/<slug>`, with the branch baked into the
  template rather than left as a variable a server would only have to refuse.
  Reads come from the authored files, not the index, so a resource reflects the
  working tree rather than the last compile, and works on a static project with
  no database. `graft://<branch>/schema` serves the same payload as
  `describe_schema`, for attaching once instead of fetching each time.

  The template's URI variables autocomplete from what exists, and the slug list
  narrows to the collection already chosen.

  Also adds `guardedResource`, so a failed resource read carries its `fix`. A
  tool failure is a value that can hold the code, the fix and the recovery text;
  a resource read has no such envelope, and a GraftError escaping raw arrived
  with its fix stripped off.

- fe8b02f: Declare what every MCP tool does to the world, and answer with data as well as
  prose.

  All 18 tools now carry `ToolAnnotations` — the hints the protocol has had since
  2025-03-26 and Graft shipped none of. Every tool looked identical to a client,
  so `search_content` and `delete_content` were offered on the same terms, and a
  client that asks a human before a destructive call had nothing to key on. Reads
  are `readOnlyHint`, `delete_content` / `put_asset` / `decide_approval` /
  `run_function` are `destructiveHint`, `write_content` is a non-destructive
  change where `contentDir` is a git work tree, which is the ordinary case and
  the one the hint is set for — outside one an overwrite has no undo, and the
  hint is then optimistic. Nothing claims an open world: the domain is the
  collections a project declares.

  These are hints and not a boundary, exactly as the spec says. Graft's real gates
  are unchanged — the scope check, the one-shot input-bound approval, the Postgres
  role separation. This makes an honest client's UX correct; it does not make a
  dishonest one safe.

  Tool results also carry `structuredContent` (MCP 2025-06-18) whenever the
  payload is an object. Every tool already built a JS object and serialised it, so
  each caller parsed the prose back into the shape it started as. The text block
  is byte-identical, so a client that predates the field sees no change.

  `@modelcontextprotocol/sdk` moves to ^1.30.0.

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

- a442299: Add `approvalPolicy: "unattended"`, so a caller with no human behind it can run
  a destructive function.

  `"none"` and `"human"` both had no answer for a scheduled job or a CI
  migration. The destructive arm of the gate had no off switch at all, which is
  the absence of a policy rather than a policy: those callers could never invoke
  a destructive function, ever.

  `"unattended"` turns the gate off entirely. Everything else is unchanged —
  every invocation still writes its audit row with actor, correlation id and git
  SHA, and access rules and rate limits still apply. What is given up is the
  waiting, not the accounting.

  It is deliberately **not on the MCP surface**. `GraftMcpOptions` accepts only
  `"none"` and `"human"`, so there is no server setting that makes `run_function`
  stop asking before a destructive call. The policy exists for a caller with no
  human behind it; an MCP mount exists because an agent is calling it, and the
  agent is precisely the party the gate is there to stop. On `graft serve` that
  split is observable — the env var lifts the gate on `POST /api/fn` and leaves
  `POST /api/mcp` gated.

  `graft serve` reads it from `GRAFT_APPROVAL_POLICY=unattended` and warns on
  every boot while it is on, because an env var is one line in a dashboard and
  the log is where a mistake gets noticed.

  Worth being explicit about the trade: git restores authored content, so a
  deleted document comes back, but it does not restore operational data.
  `deleteRecord` removes rows outright and the asset store keeps no history.

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
  - @usegraft/registry@1.0.0-beta.0
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

- 2eb24ed: MCP over HTTP fails closed. Authentication is no longer opt-in.

  `createGraftMcpHandler` had `requireActor?: boolean` defaulting to **off**, on a
  handler whose own docs advertise embedding it in "a Next.js route, a self-host
  container, Vercel Fluid, or a Worker". Forgetting it published `write_content`,
  `put_asset`, `delete_content` and `decide_approval` to anyone who found the URL —
  and unlike `graft serve`, a library embedding got no warning at all.

  **Breaking:**

  - `requireActor` is replaced by `allowAnonymous`, which defaults to `false`.
  - Constructing a handler with neither an `actor` resolver nor
    `allowAnonymous: true` now **throws** (`CONFIG_INVALID`). A deployer who
    forgets gets a startup failure with a fix line instead of an open endpoint.
  - `graft serve` derives the default from the bind host: anonymous MCP is served
    on loopback (zero-config local dev) and refused anywhere else.
    `GRAFT_MCP_REQUIRE_AUTH` is retired — its secure value (`1`) is now the
    default, so deployments that set it are unaffected. Off loopback,
    `GRAFT_MCP_ALLOW_ANONYMOUS=1` is a deliberate, warned-about opt-in for
    operators fronting the server with their own auth proxy.
  - The insecure-bind warning now tests what is _enforced_. It previously treated
    "a dev token exists" as sufficient, so setting `GRAFT_DEV_TOKEN` silenced the
    warning while anonymous callers kept reaching `decide_approval`.

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

- 301c817: Fixes found by independent review of the hardening work itself.

  - **The rate-limit peer is no longer a header.** `x-graft-peer` was stripped and
    re-set by Graft's Node adapter, which is sound for `graft serve` and worthless
    in a Next.js or Astro route that passes the browser's Request through
    untouched — a client could send the header and choose its own bucket. That is
    the `x-forwarded-for` bug, relocated to a header nobody knew they had to
    strip. The peer is now registered against the Request object in-process
    (`setRequestPeer` / `getRequestPeer`), which nothing over the wire can forge.
    `PEER_HEADER` is removed. Deployments with no adapter share one `unknown`
    bucket unless they declare `trustedProxyHops`; both examples now do.
  - **`@usegraft/mdx-safety` parses what the renderer parses, and fails closed.**
    The checker used `remark-parse` + `remark-mdx` while `MdxBody` compiles with
    `remark-gfm` — so source that failed to parse here but compiled there was
    waved through by the old "unparseable means nothing to execute" shortcut. GFM
    is now enabled on both sides, and unparseable source throws
    `UncheckableMdxError` instead of returning `[]`.
  - **Scripting elements and inline event handlers are refused.**
    `<script>alert(1)</script>` and `<img onerror="…">` contain no `{}`
    expression, so the expression checks never saw them. The module now documents
    that it is not a general HTML sanitiser.
  - **`createGraftMcp` fails closed when `actor` is set without `connectionActor`.**
    That combination silently disabled every MCP write-tool scope check, and it
    shipped in one of our own example scripts.

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
  - @usegraft/registry@0.2.0
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
- @usegraft/registry@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/compiler@0.1.0
  - @usegraft/assets@0.1.0
  - @usegraft/contracts@0.1.0
  - @usegraft/db@0.1.0
  - @usegraft/registry@0.1.0
