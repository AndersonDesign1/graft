# @usegraft/mdx-safety

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
