# @usegraft/mdx-safety

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

## 1.0.0-beta.0

### Patch Changes

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

- Updated dependencies [15568eb]
- Updated dependencies [e2829b4]
  - @usegraft/contracts@1.0.0-beta.0

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

### Patch Changes

- Updated dependencies [61b9ac4]
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
  - @usegraft/contracts@0.2.0
