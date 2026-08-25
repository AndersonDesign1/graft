# [BUG] moduleIdentifier collisions generate duplicate import declarations, breaking the regenerated barrel

**File:** [`packages/registry/src/barrel.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/src/barrel.ts#L18-L30) (lines 18, 29, 30)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-generated-code-collision`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

moduleIdentifier (L18-21) maps distinct module basenames onto the same camelCase identifier: graft/my-mod.ts and graft/myMod.ts both become myMod, and graft/a_b.ts collides with graft/aB.ts ('_' is consumed by [^a-zA-Z0-9]+ and the following letter uppercased). barrelSource (L29-30) dedupes basenames but not resulting identifiers, so it emits `import * as myMod from "./my-mod";` and `import * as myMod from "./myMod";` — duplicate declarations that make the regenerated graft/index.ts fail TypeScript compilation. Since the header marks the barrel 'do not edit' generated infra, a developer hitting this has no sanctioned fix path. listGraftModules feeds real disk filenames into this, so mixed kebab/camel naming in one project triggers it deterministically.

## Recommendation

Detect collisions in barrelSource: if two entries map to the same identifier, either throw a descriptive GraftError telling the operator which filenames conflict, or disambiguate deterministically (e.g., append a numeric suffix) while keeping imports valid.

## Revalidation

**Verdict:** true-positive

Verified the collision mechanics directly in barrel.ts: moduleIdentifier (L18-21) strips non-alphanumeric runs and uppercases the following letter, so 'my-mod' → myMod (identical to a literal myMod.ts) and 'a_b' → aB (identical to aB.ts); distinct filenames deterministically collapse onto one identifier. barrelSource (L29-30) builds entries from a Set of basenames — deduplicating basenames only — and emits one 'import * as <id> from "./<base>";' per entry, so two colliding entries produce two import bindings with the same identifier, which is a duplicate-declaration syntax/type error that breaks the regenerated graft/index.ts compilation entirely. The inputs are real disk state: listGraftModules feeds top-level graft/ filenames and planAdd adds manifest targets, and nothing upstream enforces a single naming convention, so mixed kebab/camel naming triggers this deterministically. Because the file is header-marked generated infra ('do not edit'), the operator has no sanctioned workaround short of renaming modules. The unit tests only cover basename dedupe ('comments' twice) and never identifier collisions, confirming the gap is unnoticed. Severity BUG is right: it breaks the build but is not security-relevant.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
