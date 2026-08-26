---
"@usegraft/mdx-safety": minor
"@usegraft/sdk-next": minor
"@usegraft/studio": minor
"@usegraft/mcp": minor
---

Authored MDX no longer executes as JavaScript by default.

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
