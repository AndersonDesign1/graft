# @usegraft/mcp

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
