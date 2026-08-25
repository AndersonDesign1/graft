# [MEDIUM] listComments filters AFTER applying the row cap — attackers can censor all approved comments site-wide

**File:** [`packages/registry/registry/comments/graft/comments.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/registry/comments/graft/comments.ts#L63-L66) (lines 63, 66)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

listComments fetches the newest `limit` rows across the ENTIRE collection (all pageSlugs, both approved and unapproved) via listRecords (line 63), and only afterwards filters in JS for `approved && pageSlug === ctx.input.pageSlug` (line 66). Two consequences: (1) An unauthenticated attacker can suppress every approved comment on every page by posting >=100 pending comments (rate-limited to 5/min, so ~20 minutes — or near-instantly given the spoofable rate identity in createFunctionsHandler, see related finding). Because ordering is newest-first, legitimate approved comments fall outside the scanned window and silently disappear from the public listing. (2) Even without an attacker, any page whose comments are older than the newest 100 records loses its comments entirely, so multi-page sites silently truncate. This breaks the function's core guarantee ('List approved comments for a page') and gives an anonymous attacker integrity/availability control over user-generated content display.

## Recommendation

Push the predicates into the database query (WHERE approved = true AND page_slug = $page ORDER BY created_at DESC LIMIT n), e.g. extend listRecords with a `where` option or add a dedicated filtered read helper. Never cap rows before filtering.

## Revalidation

**Verdict:** true-positive

Registry copy is byte-for-byte the same pattern: listRecords caps at newest-N rows collection-wide (records.ts filters only branchId+collection, orders createdAt DESC), then the handler filters approved && pageSlug in JS afterwards. An anonymous attacker posting ≥100 pending comments (public postComment; rate identity is the spoofable first-XFF entry per functions-handler.ts clientIp()) censors every approved comment on every page from public listings until moderators purge spam — silent, no error surfaced. Even benign operation truncates older pages' comments once the collection exceeds the window. Same vulnerability class as F1 but a different file (registry primitive shipped to deployments), so not a duplicate under the per-file rule. MEDIUM is right: integrity/availability of UGC display without permanent data loss.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
