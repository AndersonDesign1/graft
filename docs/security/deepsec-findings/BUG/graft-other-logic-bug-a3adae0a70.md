# [BUG] Nullish coalescing skips empty-string fallback, backfilling empty meta descriptions

**File:** [`examples/landing-page/migrations/0001-pages-description.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/migrations/0001-pages-description.ts#L20-L30) (lines 20, 24, 30)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The transform derives `description` via `existing ?? tagline ?? firstSentence ?? title` (line 30). `??` only falls through on null/undefined, but `firstSentence` is computed from `body` and yields "" (empty string, not nullish) whenever the document body is empty or consists solely of headings/markdown decoration that trims away (lines 20-24: replace -> trim -> split -> [0]). In that case the documented intent — 'else the title' — is never reached: the migration backfills `description: ""`, defeating the stated purpose ('every existing page needs one') for body-less documents and producing empty meta/og:description tags. This is a data-quality logic error in a backfill, not exploitable; note also that `title` itself defaults to "", so the final fallback cannot be nullish either.

## Recommendation

Filter out empty results before the fallback chain, e.g. compute candidates as `[existing, tagline, firstSentence?.trim(), title].find(v => v)` or use `||` semantics for the derived strings (safe here since none are legitimately meant to be empty), so a blank first sentence falls through to `title`.

## Revalidation

**Verdict:** true-positive

Verified against the source. firstSentence is computed as body.replace(/^#+ .*$/gm, '').replace(/[*_`>[\]]/g, '').trim().split(/(?<=\.)\s/)[0]; when the body is empty or consists solely of headings/markdown decoration, trim reduces it to '' and split always yields [''], so firstSentence === '' — an empty string, not nullish. The fallback expression existing ?? tagline ?? firstSentence ?? title therefore short-circuits at '' and the documented final fallback ('else the title', stated in the file header and description) is never reached; body-less documents get description: ''. Since '' is a valid string it passes post-backfill schema validation, silently shipping pages with empty meta/og:description tags, defeating the migration's stated purpose ('every existing page needs one'). Secondary confirmation of sloppiness: title itself defaults to '', so the terminal ?? can never fall through anyway. This is a pure data-quality logic error in a backfill tool with no security impact — not exploitable by any party — but the described misbehavior is real and deterministic, which is what matters for a BUG-classified finding.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
