# @usegraft/cli

## 1.0.0-beta.0

### Minor Changes

- 2561b47: **BREAKING:** approval policy moves from `GRAFT_APPROVAL_POLICY` to
  `approvalPolicy` in `graft.config.ts`. The env var is ignored, and `graft serve`
  warns once at boot if it is still set.

  `createFunctionsHandler` has documented this setting as config-owned all along:
  "deliberately a value the operator writes in config rather than an env var,
  because turning off the gate on irreversible work should appear in a diff and a
  review." The CLI was the piece still reading an env var, so the rationale was
  written down and not enforced. This is the setting that lets `deleteRecord`
  hard-delete rows with no human in the loop, and a hosting dashboard is where
  that decision goes unreviewed. It is parsed like `mdxTrust`: an unknown value is
  refused rather than defaulted, so a typo cannot silently pick a weaker policy.

  ```ts
  // graft.config.ts
  export const approvalPolicy = "unattended";
  ```

  **An approval presented to an ungated call is now spent.** Under `"unattended"`
  the gate is skipped, and the whole block went with it, including
  `approvals.consume`. A granted row stayed `approved` and replayable: tighten the
  policy later and that row still authorized a destructive call nobody
  re-reviewed. One-shot has to survive a policy change, which is exactly when the
  stale row is dangerous. Consuming is best-effort here, because an ungated call
  must not fail on the approval store.

  **`run_function` over MCP gets the same rate-limit backstop as `POST /api/fn`.**
  `graft serve` passed `{ limit: 60, windowSeconds: 60 }` to the functions handler
  and nothing to the MCP handler, so a function with no per-function `rateLimit`
  was capped on one transport and uncapped on the other. `tools/functions.ts`
  claims both surfaces apply rate limits identically; now they do.

  **`assertSafeMdx` reports unparseable MDX as `INPUT_VALIDATION_FAILED`.**
  `UncheckableMdxError` escaped it raw, so `write_content` and a Studio save
  returned a bare `Error` where every other rejection on that path is a structured
  `GraftError` — a client could not tell malformed input from a transport fault.
  `graft compile` catches the raw error itself and is unaffected.

  All four found by cubic on the pull request.

### Patch Changes

- d5f5567: Let the content API be read from a browser on another origin.

  `@usegraft/sdk-react` reads over HTTP from a browser, and the handler sent no
  CORS headers at all — so unless the app and the content API shared an origin,
  every read was blocked by the browser. That is the ordinary deployment for the
  browser client, which made it largely unusable as shipped. cubic raised it on
  the pull request.

  `createContentApiHandler` takes `allowedOrigins`: a list, or `"*"`. Omitted
  means no CORS headers and same-origin only, which stays the default because
  publishing an endpoint to other origins is the deployer's decision rather than
  a library's. `graft serve` reads `GRAFT_CONTENT_ALLOWED_ORIGINS` (comma
  separated, or `*`).

  Details that are easy to get wrong and are tested:

  - An allowed origin is echoed with `Vary: Origin`. Without `Vary`, a shared
    cache can hand one origin the response it stored for another and the
    allowlist stops meaning anything.
  - A disallowed origin gets an ordinary response with no CORS header, not a
    refusal. The browser enforces it; answering differently would turn the
    allowlist into an origin oracle for non-browser callers, who are not bound by
    CORS in the first place.
  - `OPTIONS` preflight is answered before method validation and before the rate
    limiter, so a browser asking permission is neither a `405` nor a charge
    against the budget for the read it precedes.
  - Error responses carry the headers too, or the browser hides the body and a
    developer debugging a `400` sees an opaque network failure instead of the
    `fix` this API took care to send.

- 15568eb: Rate-limit the content API, and give `graft serve` the same backstop there it
  already gave functions.

  `graft serve` passed `rateLimit: { limit: 60, windowSeconds: 60 }` to
  `createFunctionsHandler` and nothing to `createContentApiHandler`, which had no
  such option to pass. Greptile demonstrated the consequence on the pull request
  by running it: 61 requests to `/api/content/v1/documents`, 61 responses of
  `200`, no `Retry-After` on the last one. These routes authenticate nobody and
  run database listings and full-text searches, so one anonymous caller could
  keep the index busy for as long as it liked.

  `createContentApiHandler` now takes `rateLimit` and `trustedProxyHops`.
  Omitting `rateLimit` means unlimited, which stays correct for a handler mounted
  behind something that already limits. `graft serve` passes the same 60 per 60
  seconds it gives functions.

  The counter is in memory rather than in the audit table. The function limiter
  counts rows it is already writing; these are reads that write nothing, and
  adding a write per read to enforce a read limit inverts the cost of the thing
  being protected. Two honest consequences, both documented: it is per process,
  so N replicas allow N times the limit and a restart resets it; and it is a
  fixed window where functions get a rolling one. A deployment needing an exact
  global limit puts it in the proxy already terminating TLS.

  The check runs before the index is touched, and after method and route
  validation. Both halves are tested: a limit that fires once the query has
  already run protects nothing, and charging a `405` to the bucket would let
  someone probing with the wrong method spend the shared anonymous budget.

  **The caller-identity rule is now shared rather than copied.** `rateIdentity`
  and the peer registry move from `@usegraft/core` to `@usegraft/contracts`,
  which both packages already depend on, and `@usegraft/core` re-exports them so
  `setRequestPeer` keeps resolving where callers already import it. That rule —
  never read `x-forwarded-for` unless the deployment declares its proxy depth,
  then count from the right — is listed in `.greptile/rules.md` as a security
  invariant precisely because the obvious implementation is the wrong one, and
  two copies of it is how a future fix lands in only one.

  Also documents what was true before this change and unwritten: the content API
  performs no authentication at all, so its `collections` list is a security
  boundary rather than a convenience, and `graft serve` registers every
  collection in the config.

- 1139a88: Add a versioned, read-only authored-content HTTP API and a remote
  `ContentIndexReader`. `graft serve` now mounts document reads and search at
  `/api/content/v1`, fixed to the server's resolved branch.
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

- 76baf51: Add a real release channel switch, and one GitHub Release per version.

  Canary was doing a job it cannot do. A snapshot is `0.0.0-canary-<timestamp>`
  forever: it sorts _below_ every real release, npm never offers it as an
  upgrade, and there is no path from it to a stable version — you hand someone a
  build and they pin a timestamp. It answers "does this commit work?", not "is the
  next version ready?"

  Beta is changesets prerelease mode: `1.0.0-beta.0` → `1.0.0-beta.1` → `1.0.0`.
  A tester runs `npm i @usegraft/cli@beta` once and gets each new beta as an
  ordinary upgrade, while `latest` stays where it is.

  ```sh
  pnpm release:beta-enter   # commit .changeset/pre.json
  pnpm release:beta-exit    # graduate to stable
  pnpm release:channel      # which channel am I on?
  ```

  release.yml's own comment named the reason pre mode was avoided: the state is
  committed, feat/core takes every ordinary push, and nothing would remind you to
  leave. So the release job now prints the active channel before anything
  publishes, and the canary path refuses to run in pre mode and says why. Being
  in beta is something the log tells you, not something you remember.

  **One release per version.** `fixed` makes all 21 packages one product on one
  version line, but changesets/action tags and releases each separately — 21 tags
  and 21 GitHub Releases per version, with one arbitrarily flagged "Latest"
  because GitHub picks by recency. Tags fragmented the history instead of
  grouping it. A `v<version>` release now collects every package's changelog
  entry. The per-package tags stay, because npm and provenance point at them.

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

- 4ac881c: CI asserts that `.github/rulesets/*.json` still matches the branch protection
  GitHub is actually enforcing.

  Those files are a record, not a mechanism — a rule relaxed in the web UI leaves
  no diff anywhere, which is why the directory exists and also its weakness. The
  README carried "checked 2026-08-31", a claim with a shelf life. `pnpm
check:ruleset-drift` turns it into a job.

  It is deliberately one-directional: it never applies the file, because a commit
  that could rewrite branch protection is a commit that could remove it. The
  record can fail the build without being able to weaken the branch.

  Reading bypass actors needs `administration: read`, which the built-in
  `GITHUB_TOKEN` cannot hold — that permission is not one a workflow may request
  for it. The job reads a `RULESETS_TOKEN` secret (a fine-grained PAT scoped to
  this repository, `Administration: Read-only`). Until it exists the job skips and
  says why rather than passing: without `bypass_actors` GitHub answers `200` with
  `rules` alone, and checking the rules while never checking who can ignore them
  prints a green tick nobody should trust. A fork's pull request sees the same
  skip, so outside contributors are not blocked. It runs as its own job rather
  than inside `verify`, keeping that token away from the runner that executes
  every installed dependency.

- 36d6045: Fix the install command on every package page. `npx graft` resolves to an
  unrelated package on npm, so the documented way to run the CLI without
  installing fetched the wrong thing. It is `npx @usegraft/cli` everywhere now,
  with a note saying why the scoped name is needed.

  Fix the `graftRoute` example in `@usegraft/sdk-astro`. It showed a config
  object, but `graftRoute` takes the handler, so the snippet did not compile.

  Document the static index in the SDK READMEs. `createClient` and `createGraft`
  both accept `index` from `openStaticIndex(".graft/index.db")`, which is what
  `graft init` scaffolds by default, and none of the READMEs mentioned it. Every
  read example now shows where its `db` or `index` comes from instead of leaving
  the handle undefined.

  `@usegraft/sdk-sveltekit` gets the same treatment, and its README ships in this
  release. It was `private` and so could not be named in a changeset at all. It
  is public now, at the same version as the rest of the workspace.

- 3bb7f7b: Publish `@usegraft/sdk-sveltekit`. It sat at `0.1.0` and `private` while every
  other package in the workspace was at `0.2.0`, and `private` is what kept it
  there. The release config puts every `@usegraft/*` package in one `fixed`
  group, and changesets counts a private package as ignored, so naming this one
  beside any other failed the mixed-changeset check and the release plan refused
  to build. That left no way to ship a fix for it at all, and it fell one version
  further behind on each release. It is public at `0.2.0` now and versions with
  everything else.

  Nothing in the package itself changed. The README, the adapter and its tests
  were already written and are untouched. `src/` still tracks
  `@usegraft/sdk-astro`: the same `createGraft` and `graftRoute`, differing only
  in doc comments, the `context` to `event` rename that SvelteKit's
  `RequestEvent` asks for, and the URL one test uses as a fixture. That adapter
  is exercised by `examples/docs-site`, so this code path has been covered all
  along and only the packaging held it back.

  Pin the MinIO images in the self-host Dockerfile to digests. `minio/minio` and
  `minio/mc` were both on `latest`, which MinIO moves on every release, so the
  image the README tells people to `docker run` could change from one build to
  the next while nothing in this repo did, and a bad upstream release would
  arrive with no way to tell what had shifted. Every GitHub Action here is
  already SHA-pinned for that reason.

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
- Updated dependencies [d5f5567]
- Updated dependencies [15568eb]
- Updated dependencies [1139a88]
- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [18ac061]
- Updated dependencies [d3c51d1]
- Updated dependencies [ffd5a07]
- Updated dependencies [e36c09b]
- Updated dependencies [04f7576]
- Updated dependencies [23b73fa]
- Updated dependencies [9859435]
- Updated dependencies [0db04f7]
- Updated dependencies [fe8b02f]
- Updated dependencies [655e4d1]
- Updated dependencies [76baf51]
- Updated dependencies [a6b7ddf]
- Updated dependencies [a442299]
  - @usegraft/core@1.0.0-beta.0
  - @usegraft/mdx-safety@1.0.0-beta.0
  - @usegraft/content-api@1.0.0-beta.0
  - @usegraft/contracts@1.0.0-beta.0
  - @usegraft/mcp@1.0.0-beta.0
  - @usegraft/db@1.0.0-beta.0
  - @usegraft/compiler@1.0.0-beta.0
  - @usegraft/studio@1.0.0-beta.0
  - @usegraft/auth@1.0.0-beta.0
  - @usegraft/content-migrations@1.0.0-beta.0
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

- ed103a8: Rate limits key on the real peer address, and concurrency can no longer outrun
  them.

  Every rate limit in the product was bypassable with a header.
  `clientIp` read `x-forwarded-for.split(",")[0]` — the **leftmost** entry, which
  under XFF's append semantics is whatever the original client wrote. Rotating the
  header minted a fresh bucket per request, defeating per-function limits, the
  handler-wide backstop, and the anti-brute-force property they exist for.

  Separately the limiter counted prior audit rows, ran the handler, and recorded
  its row afterwards — a window spanning the entire invocation. N concurrent
  requests all read the same count, all saw room, and all ran.

  **Breaking:**

  - `AuditStore.record(entry)` is replaced by `reserve(entry) => id` and
    `settle(id, outcome)`. The row is inserted before the call is admitted, so the
    counter and the evidence are the same row. A row left `in_flight` is a crashed
    or still-running invocation, which is worth being able to see.
  - `FunctionsHandlerOptions.trustedProxyHops` (default `0`) controls whether
    `x-forwarded-for` is read at all. At `0` it is ignored entirely. At `n`, the
    nth entry **from the right** is used — the address your own nearest proxy
    observed, which a client cannot forge past. Set it to the number of proxies
    you run.
  - `runtimeRoleGrantsSql` grants `UPDATE (status, duration_ms) ON audit_log`.
    Column-scoped deliberately: the runtime may record how a call ended, never
    rewrite who made it or what it counted against.

  `PEER_HEADER` (`x-graft-peer`) is exported from `@usegraft/contracts`. Graft's
  Node adapter strips any inbound copy and sets it from the socket, so unlike
  `x-forwarded-for` it cannot be written by a client.

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
- Updated dependencies [4bde361]
- Updated dependencies [2eb24ed]
- Updated dependencies [1aea0da]
- Updated dependencies [f423a6e]
- Updated dependencies [92fe85e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
- Updated dependencies [52d7488]
- Updated dependencies [6ebfe18]
- Updated dependencies [d6cbc3d]
  - @usegraft/contracts@0.2.0
  - @usegraft/studio@0.2.0
  - @usegraft/core@0.2.0
  - @usegraft/mcp@0.2.0
  - @usegraft/db@0.2.0
  - @usegraft/registry@0.2.0
  - @usegraft/compiler@0.2.0
  - @usegraft/mdx-safety@0.2.0
  - @usegraft/assets@0.2.0
  - @usegraft/auth@0.2.0
  - @usegraft/content-migrations@0.2.0

## 0.1.1

### Patch Changes

- 6737b5b: `graft --version` reported `0.0.0` instead of the released version.

  The version was a hardcoded constant that changesets never touched, and the test
  asserted `toContain("0.0.0")` — so it passed _because_ of the bug. The version is
  now read from the manifest at runtime, and the test asserts against that value
  rather than a literal.

  - @usegraft/assets@0.1.1
  - @usegraft/auth@0.1.1
  - @usegraft/compiler@0.1.1
  - @usegraft/content-migrations@0.1.1
  - @usegraft/contracts@0.1.1
  - @usegraft/core@0.1.1
  - @usegraft/db@0.1.1
  - @usegraft/mcp@0.1.1
  - @usegraft/registry@0.1.1
  - @usegraft/studio@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/auth@0.1.0
  - @usegraft/compiler@0.1.0
  - @usegraft/content-migrations@0.1.0
  - @usegraft/mcp@0.1.0
  - @usegraft/studio@0.1.0
  - @usegraft/assets@0.1.0
  - @usegraft/contracts@0.1.0
  - @usegraft/db@0.1.0
  - @usegraft/registry@0.1.0
