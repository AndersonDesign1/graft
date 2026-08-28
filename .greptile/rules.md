# Review rules for Graft

Graft is an agent-native CMS. Content, schema, logic, and access are code that an
agent edits directly, so most of what can go wrong here is not a generic defect.
It is a change that quietly weakens one of the invariants below. Check these
first, then review the code normally.

`SECURITY.md` and `CONVENTIONS.md` are the sources these rules come from. If a
diff contradicts one of them and the file is not updated in the same change, say
so.

## The approval gate

The approval gate is the one control that holds even against a stolen runtime
credential. Treat every change near it as security relevant.

- The deciding identity is derived from the verified caller at the deciding
  surface. It is never read from request input. There is no `decidedBy` argument
  on any surface. If a diff adds a `decidedBy`, `decider`, `approver`, or `actor`
  field to a request body, a query parameter, an MCP tool schema, or a CLI flag
  that then reaches `decideApproval`, that is a defect.
- A requester can never decide their own approval. `decideApproval` throws
  `APPROVAL_SELF_DECISION`, and the check lives inside the UPDATE's `WHERE`, not
  only in a guard ahead of it. Moving that predicate out of SQL into application
  code weakens it even when the behaviour looks identical.
- An approval with no identified requester cannot be decided at all. It throws
  `APPROVAL_UNATTRIBUTED`. Reintroducing an `IS NULL` arm, which would let anyone
  including the filer approve such a row, is a defect.
- Approvals are one-shot. Consume is a single conditional UPDATE, atomic, and
  bound to the exact function name plus the canonical input the approval was
  requested for. Any change that relaxes that binding, matches on the function
  name alone, or splits consume into read-then-write lets one approval authorize
  a call the human never saw.
- `decided_role` is stamped server side from Postgres `current_user`. It must
  never become a value the caller supplies.
- No agent runtime token carries `approvals:decide`. Flag a change that grants it
  to an agent path.

## Destructive operations

Destructive operations are human-gated under every approval policy. That is not
configurable. Flag any new policy value, environment variable, config flag, or
code path that would let a destructive operation proceed without a human
decision.

## The hardened Postgres role

`graft harden <role>` produces the runtime role, and the all-in-one container
applies the split by default.

- The runtime role holds no `UPDATE` on `approvals`.
- Its `INSERT` on `approvals` is column-scoped and cannot name `status` or
  `decided_by`.

Both halves are load-bearing. Withholding `UPDATE` alone still leaves a stolen
credential able to file a row that is already approved, which is cheaper than
flipping a pending one. If a diff touches the grant list in `graft harden` or the
container's default setup, check that both halves survive.

## Source of truth

- Git is authoritative for authored content. Postgres is a derived index. If the
  two disagree, git wins and the compiler rebuilds. Flag any change that treats
  the index as the primary record for authored content, or that makes a rebuild
  trust the index over the repository.
- Operational data such as orders, accounts, and progress is owned by Postgres
  and reached only through typed functions. Raw SQL against operational tables
  from outside `@usegraft/db` is a defect.

## Errors

Errors thrown across a package boundary are `GraftError` from
`@usegraft/contracts`, and they MUST carry a `fix`. The `fix` is the field an
agent acts on, so it has to name the concrete next step rather than restate the
problem. Flag any new error code with no `fix`, and any `fix` that only rewords
its own message. A change to an error message with no matching change to its
`fix` is usually a mistake.

## MCP and network surfaces

- Anonymous MCP callers are refused unless a mount explicitly opts in. Flag any
  change that would default `allowAnonymous` to true, and any mount that opts in
  without the diff saying why.
- Rate identity comes from the connection peer. `x-forwarded-for` is ignored
  entirely unless the deployment declares `trustedProxyHops`, and with `n` hops
  the `n`th entry from the RIGHT is used. Reading the leftmost entry, or reading
  the header at all when `trustedProxyHops` is 0, lets a client mint a fresh rate
  bucket per request by rotating a header it writes itself.
- Per-route scopes apply on the Studio API and on MCP tools. A new route or tool
  with no scope is a defect, not a follow-up.
- The local Studio validates the Host header and refuses cross-origin requests.
  Relaxing either to make local development easier is a defect.

## Filesystem

Every filesystem sink in `@usegraft/compiler` performs path containment with
symlink refusal. A new sink that joins a path and writes without both checks is a
traversal bug. Resolving the real path after the containment check rather than
before does not count as doing the check.

## MDX

Authored MDX is not executable. `mdxTrust` in `graft.config.ts` is the compile
side of that decision and `MdxBody`'s `trust` is the render side, and the two have
to agree. A diff that loosens one without the other is a defect even when each
side reads fine alone. `MdxBody` stays at `trust: "restricted"` unless every
author has commit access.

## Validation

Validation is one shared Zod layer across schema, compiler, and functions. The
Zod major is 4. Flag a second validation layer, a hand-rolled parse that bypasses
the shared schemas, and any package pulling in a different Zod major.

## Tests

Tests are in scope for review, not excluded from it. Unit tests stay deterministic
and run with no network or database. Integration tests are named
`*.integration.test.ts`, gate on `RUN_INTEGRATION=1`, and load `.env` in file. An
integration test that runs unconditionally will break CI for everyone, so flag it.

## Pre-1.0 breaking changes

This repo is pre-1.0 and breaking changes are welcome when they buy a better
design. Do NOT flag a deliberate break as a defect. DO flag a break that the
commit message and the pull request body do not mention. What breaks, and what a
user has to do about it, has to be written down where the changelog picks it up.

## What review skips, and why

`config.json` cannot carry comments, so the reasoning for its `ignorePatterns`
lives here. `**/dist/**`, `**/.next/**`, `**/.astro/**`, `**/.vercel/**`, and
`pnpm-lock.yaml` are build output and resolver output, not authored code.
`examples/docs-site/content/docs/errors.mdx` is generated from `ERROR_KNOWLEDGE`
in `packages/mcp/src/explain.ts` by `scripts/gen-error-docs.mjs`, so review the
registry instead. `tools/oxlint/anti-slop/**` is vendored from upstream, and
`CONVENTIONS.md` records which of its rules this repo turns down and why.
