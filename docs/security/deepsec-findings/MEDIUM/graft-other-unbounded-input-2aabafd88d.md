# [MEDIUM] postComment accepts arbitrarily large author/body/pageSlug values straight into Postgres

**File:** [`packages/registry/registry/comments/graft/comments.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/registry/registry/comments/graft/comments.ts#L37-L44) (lines 37, 42, 43, 44)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-unbounded-input`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

postComment's inputs are built with field.string()/field.text(), which compile to bare z.string() with no max() (lines 42-44; same for the collection fields at lines 25-27). An anonymous caller can therefore store multi-megabyte rows per submission. The declared mitigation ('5/min per caller', line 37) is the only bound, and that identity is spoofable for anonymous callers (x-forwarded-for handling, see the createFunctionsHandler finding), making sustained storage bloat feasible against self-hosted deployments.

## Recommendation

Add max-length constraints to the field definitions (e.g. author <= 80 chars, body <= 4000, pageSlug <= 200) so validation rejects oversized payloads before insert.

## Revalidation

**Verdict:** true-positive

Verified: field.string()/field.text() compile to bare z.string() with no maximum (field.ts), for both the function inputs and the collection fields, and insertRecord stores parsed data verbatim into the unbounded jsonb data column with no truncation path. The declared mitigation really is only the 5/min rateLimit, whose anonymous bucket key is the client-supplied first X-Forwarded-For entry (functions-handler.ts clientIp()), making sustained oversized-row injection feasible via header rotation against self-hosted/directly-exposed deployments; Next App Router imposes no route-handler body limit. Same underlying weakness as F3 but in the registry file — not a duplicate under per-file rules. MEDIUM appropriate: storage bloat, no confidentiality/integrity breach.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
