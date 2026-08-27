---
"@usegraft/compiler": minor
"@usegraft/mdx-safety": minor
"@usegraft/studio": minor
"@usegraft/mcp": minor
"@usegraft/cli": minor
"@usegraft/sdk-next": minor
---

`graft compile` refuses executable MDX, and the project declares its own trust.

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
