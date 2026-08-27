# @usegraft/mcp

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
