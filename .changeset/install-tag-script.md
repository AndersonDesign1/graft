---
"@usegraft/cli": patch
---

Keep every documented install command on the channel we actually ship.

While the repo is in beta, `latest` is an older version than the docs describe.
A README saying `npm i @usegraft/cli` sends a reader to a build that does not
match the page they read it from — during this beta that means `approvalPolicy`
in `graft.config.ts` silently doing nothing, because `0.2.0` still reads an
environment variable.

`scripts/install-tag.mjs` derives the tag from `.changeset/pre.json` instead of
anyone remembering: pre mode means `@beta`, stable means no tag.
`release:beta-enter` and `release:beta-exit` both run it, so entering and
leaving the channel rewrites 22 READMEs and the docs with it, in both
directions. CI checks it, because the failure is silent otherwise.

CHANGELOGs are deliberately untouched. They narrate what happened at a version —
"`npm i @usegraft/sdk-react` installed postgres and drizzle-orm" is a statement
about the past, and rewriting it would falsify the record.
