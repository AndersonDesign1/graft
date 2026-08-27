# 0006 — `graft compile` refuses executable MDX, and the project declares its trust

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

ADR 0004 removed the executable surface from authored MDX and gave `MdxBody` a
`trust` argument defaulting to `"restricted"`. The write paths took the same
check: MCP `write_content` and Studio saves both call `assertSafeMdx`
unconditionally, with no way to opt out.

`graft compile` did not check at all. Its docstring said so plainly: content
already in git "arrived through code review, which is the control that applies
to code."

That left the compiler and the renderer disagreeing. A git-authored body with a
`{…}` expression compiles, indexes, and then fails at render, per request, on
the page, in production. The operator finds out from a user. A compiler that
already validates frontmatter against a schema and enforces slug uniqueness has
no business passing that through.

The reasoning in the docstring was not wrong, it was incomplete. Code review is
a real control, but a project only gets to claim it if it says so. Nothing in
the config said so, and the default assumed it.

## Decision

`readDocs` checks every authored body and refuses executable constructs, so the
failure lands at build time.

Every offending document is reported in one error, not the first one found. This
is the same reasoning ADR 0004 applied within a single body, applied across the
tree: an author who fixes them one at a time learns the rule slowly and resents
it. Source the checker cannot parse is refused rather than indexed, for the
reason `findExecutableMdx` throws `UncheckableMdxError` at all: the renderer's
parser is not this one, and the gap between them is exactly where executable
source would hide.

`export const mdxTrust = "restricted" | "full"` in `graft.config.ts` is the
escape, defaulting to `"restricted"`. It follows the existing named-export
convention (`export const index = "postgres"`), so it adds a value, not a
concept. An unrecognised value is refused rather than defaulted, because a typo
that fell back would silently re-impose the restriction someone was
deliberately lifting.

`MdxBody`'s `trust` prop is unchanged and keeps its own default. Two settings
that have to agree is a real cost, and it was accepted over the alternatives:

- Reading `graft.config.ts` from `MdxBody` is not available. It is a React
  component in an SDK with no project context, and giving it one would make
  every render site config-dependent.
- Threading the value through the generated `components/mdx-components.ts` was
  rejected because `graft add` regenerates that file, so the value would go
  stale for any project that stops running `graft add`.

Instead, compile's refusal message names both settings. The moment the two can
disagree is the moment the operator is reading that error.

## Premise

Compile-time enforcement is right while `MdxBody`'s default is `"restricted"`.
The two defaults are one decision expressed twice, and the value of checking at
compile is precisely that it predicts what render will do.

**If `MdxBody`'s default ever changes, this check is wrong as written** and must
change with it, or the compiler starts refusing documents that would have
rendered.

The escape's premise is ADR 0004's: `"full"` is correct only where every author
has commit access. This ADR does not weaken that. It makes the claim explicit,
in the config, where it can be read.

## Consequences

- Breaking for any project with git-authored expression MDX that was relying on
  `MdxBody` never being asked to render it. Evidence the break is narrow: all 28
  authored `.mdx` files across both examples compile unchanged (7 in
  `examples/landing-page`, 21 in `examples/docs-site`).
- `readDocs` gains a third parameter and `CompileOptions` a field, threaded
  through the CLI, MCP and Studio compile paths. All optional, all defaulting to
  `"restricted"`, so a call site that forgets it is safe rather than permissive.
- MCP and Studio recompile the whole tree after a write, so a project that sets
  `mdxTrust = "full"` needs the value at those surfaces too, not just in the
  CLI. Both option types carry it.
- The compiler now depends on `@usegraft/mdx-safety`.
- `docs/configuration` gained a `graft.config.ts` exports table. The config
  contract was previously documented only in the loader's own docstring.
