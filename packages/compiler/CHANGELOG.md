# @usegraft/compiler

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
