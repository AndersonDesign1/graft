# 0004 — Authored MDX is not executable unless the caller opts in

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

`MdxBody` compiles with `outputFormat: "function-body"` and evaluates via
`run()`, which is `new Function` in the host runtime. A `{expr}` or an `import`
in a stored body is arbitrary server-side JavaScript with `process`, `fetch` and
dynamic `import()`.

For content the operator wrote and reviewed in git, that is the feature — it is
what "content is code" means, and code review is the control that applies to
code. The initial assessment of the finding said exactly that and stopped there.

It was the wrong assessment because it assumed one deployment model. If Graft
hosts Studio, or a user hosts it for their own writers, then "can write content"
and "can execute code on the render host" stop being the same privilege — and on
shared infrastructure, one author's page reaches every other tenant.

## Decision

Remove the executable surface rather than contain it. `node:vm` is documented as
not being a security boundary, and a worker thread cannot return React elements
without breaking component identity under RSC — so containment was not available
even in principle.

`@usegraft/mdx-safety` refuses `{…}` expressions, `import`, `export`,
expression-valued attributes and `{...spread}` attributes. Prose, GFM and
components with literal attributes are unaffected.

`MdxBody` takes `trust: "restricted" | "full"`, defaulting to `"restricted"`.
Checked at render **and** at write, because content can also arrive through a
direct database write with the runtime credential, which no write-side guard sees.

## Premise

Content reaching the renderer may have been authored by someone the operator
does not fully trust. True the moment Studio is hosted for anyone but yourself.

**If a deployment is genuinely single-tenant and every author has commit access,
`trust: "full"` is the correct setting** and this decision does not argue
otherwise. The default is chosen for the case that is dangerous when wrong.

## Consequences

- Breaking for anyone rendering expression-bearing MDX. Evidence it is a narrow
  break: all 28 authored `.mdx` files across both examples pass unchanged. Real
  content does not reach for expressions.
- Full MDX stays available and is one named argument away.
- Refused content reports every offending construct at once rather than the
  first, because an author who fixes them one at a time learns the rule slowly
  and resents it.
