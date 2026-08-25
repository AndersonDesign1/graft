# [BUG] Validated migration output discarded; change detection uses key-order-sensitive JSON.stringify equality

**File:** [`packages/core/src/data-migrations.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/core/src/data-migrations.ts#L114-L123) (lines 114, 122, 123)
**Project:** graft
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

In runDataMigration, collection.schema.safeParse(next) succeeds (L114-115) but the code persists the RAW transform output next rather than validated.data (updates.push({ id, data: next }), L123). Zod-level transforms, defaults, and coercions therefore never materialize in the stored rows, so migrated data can permanently drift from the canonical shape the schema produces — undermining the stated goal of backfilling rows to the NEW shape. Additionally, the changed/unchanged decision compares JSON.stringify(next) === JSON.stringify(row.data) (L122), which is sensitive to object key ordering and silently drops undefined values: a logically identical row whose keys come back in a different order (typical when a transform reconstructs objects) is counted as changed and rewritten, producing spurious updates and inflated docCount ledger entries across every run of an already-applied migration.

## Recommendation

Persist validated.data instead of next, and compare canonical forms (e.g., the same canonicalJson helper used for approvals, which sorts keys, or deep-equal) rather than raw JSON.stringify.

## Revalidation

**Verdict:** true-positive

Both defects verified in runDataMigration: after collection.schema.safeParse(next) succeeds, the code pushes {id, data: next} — the RAW transform output — never validated.data, so Zod defaults/coercions/transforms never materialize in stored rows even though the module's stated purpose is backfilling rows 'to the NEW shape'; reads stay correct only because parseStoredRow re-validates, masking permanent byte-level drift that future raw-data migrations will trip over. Second, the changed/unchanged decision is raw JSON.stringify(next) === JSON.stringify(row.data): order-sensitive and undefined-dropping. Because Postgres jsonb normalizes key order (length-then-bytewise) on write/read, any transform that reconstructs objects in author-written order compares unequal to the round-tripped row even when logically identical — the row is counted changed, spuriously rewritten, and counted in docCount. One correction to the finding's framing: the shipped graft migrate command gates re-execution through the migrations_applied ledger (pending = migrations.filter(m => !appliedIds.has(m.id))), so inflated ledgers 'across every run' only occur for repeat invocations via the exported runDataMigration API or fresh branches, not ordinary CLI re-runs. Still a genuine logic bug in a data-integrity path; BUG severity is correct and it is not security-exploitable beyond operator confusion.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
