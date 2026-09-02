---
"@usegraft/mcp": minor
"@usegraft/cli": patch
---

Add `list_packages`, so an agent can answer "what do I install?"

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
