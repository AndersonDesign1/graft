# [MEDIUM] listComments applies limit before filtering, letting anyone silently hide approved comments

**File:** [`examples/landing-page/graft/comments.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/graft/comments.ts#L53-L66) (lines 53, 60, 62, 63, 66)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-content-suppression`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The listComments handler (L62-66) fetches the newest N rows across ALL comments on every page slug — including unapproved spam held for moderation — and only THEN filters with `.filter((r) => r.data.approved && r.data.pageSlug === ctx.input.pageSlug)`. Because `postComment` (L33-50) is a public mutation accepting arbitrary pageSlugs, an attacker can fill the default 100-row scan window with unapproved comments (5/min legitimately, faster if the XFF-keyed rate identity is rotated — see rate-limit-bypass finding). Once >=100 newer rows exist than an approved comment, that comment permanently disappears from every listing without any error or indication. This is unauthenticated suppression/de-facto deletion of moderator-approved content. Note the row cap spans all pages, so spam on one slug suppresses comments on every other slug.

## Recommendation

Push the predicate into SQL: filter by `approved = true AND pageSlug = ?` inside the listRecords WHERE clause (extend listRecords to accept a where condition) and apply LIMIT after filtering.

## Revalidation

**Verdict:** true-positive

Verified end-to-end. listComments (examples/landing-page/graft/comments.ts L62) calls listRecords, which in packages/core/src/records.ts selects WHERE branch_id=? AND collection='comments' ORDER BY created_at DESC LIMIT n — no predicate on approved or pageSlug. Only after the cap does the handler filter in JS (L66). postComment is public:true accepting arbitrary pageSlug strings, so an anonymous caller can mint unlimited unapproved rows (5/min per rate bucket, and the bucket key is the attacker-controlled first XFF entry per clientIp() in functions-handler.ts, or simply ~20 minutes of patience at 5/min). Once ≥100 newer rows exist, approved comments on every page silently vanish from listings (single collection-wide window), with no error. Data isn't destroyed, so suppression-not-deletion is accurate; MEDIUM holds. Concrete attack: POST 100 postComments with rotated X-Forwarded-For values, then GET listComments for any slug returns empty.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
