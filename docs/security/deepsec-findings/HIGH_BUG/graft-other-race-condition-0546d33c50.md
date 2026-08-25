# [HIGH_BUG] Flush-on-navigation saves document A's content into document B (cross-document overwrite)

**File:** [`packages/studio/src/ui/views/collections.tsx`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/studio/src/ui/views/collections.tsx#L100-L187) (lines 100, 101, 122, 140, 143, 184, 186, 187)
**Project:** graft
**Severity:** HIGH_BUG  •  **Confidence:** high  •  **Slug:** `other-race-condition`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

`useAutosave` rebinds `saveRef.current = save` during every render (packages/studio/src/ui/lib/autosave.ts), and `persist` (L100-141) reads `collection`/`slug` from the CURRENT route closure while reading the edit buffers and the comparison baseline from `latest.current`. When an operator edits document A and then selects document B before the 900ms debounce fires, React re-renders with route=B first: `persist` is recreated capturing `{collection: B, slug: B}` and `saveRef.current` is rebound to it. Only afterwards does the swap effect (L184-194) call `autosave.flush()`, which invokes this NEW persist while `latest.current` still holds document A's edited `fields`/`body`/`raw` and `snapshot.doc` = A's DocumentDto (`openDoc(B)` hasn't resolved yet). The `hasUnsavedChanges` guard compares against A's own loaded snapshot, so it correctly reports 'changed', and the save proceeds as `PUT /document {collection: B.name, slug: B.slug, data: <A's composed frontmatter>, body: <A's body>}` (raw mode likewise writes A's `raw`). The server writes document B's file with document A's entire content; the toast even reports 'Saved B/B'. This silently destroys document B's content — precisely the 'pending edit lands on the wrong file' failure the comment on L183 claims the flush prevents. Secondary variant: navigating across two documents quickly starts two unsequenced `openDoc` fetches with no cancellation/stale-response guard in `openDoc` (L146-171); if responses resolve out of order the editor displays one document's bytes under another's route, and the next debounced save repeats the cross-document write.

## Recommendation

Make the save self-consistent: capture the document identity inside the same ref as the buffers (e.g., include `doc.collection`/`doc.slug` from `snapshot.doc` in the payload instead of reading them from the route closure), so a flush always targets the document whose bytes it holds — and skip the write when they disagree with the current route. Alternatively, flush synchronously BEFORE the route changes (in the tree's click handler) rather than in an effect that runs after re-render. Additionally, sequence `openDoc` fetches (ignore/cancel responses whose `{collection, slug}` no longer match the current route) to close the out-of-order-response variant.

## Revalidation

**Verdict:** true-positive

Traced the full sequence and it holds. On navigation A→B within the debounce window, React re-renders CollectionsView with route=B: persist is recreated via useCallback([route.collection, route.slug, ...]) closing over B, and useAutosave rebinds saveRef.current during that render (autosave.ts 'saveRef.current = save'); the swap effect (L184-194) then calls autosave.flush() BEFORE openDoc(B)'s fetch resolves, so latest.current still holds document A's fields/body/raw and A's DocumentDto. commit() invokes the NEW persist, which takes collection/slug from the route closure (B) but buffers and baseline from latest.current (A); hasUnsavedChanges compares against A's own loaded snapshot so the edited draft correctly reads as changed, and the PUT carries {collection: B, slug: B, data: <A frontmatter>, body: <A body>}. Server-side, api.ts PUT /document hands the payload straight to writeDocument (studio/content.ts), which composes and writes B's file with no consistency check against what the editor had loaded — A's content destroys B's on disk, and the toast reports 'Saved B/B', matching the finding. I checked the plausible counter-mitigations: composeData/buildForm tolerate mismatched or undeclared fields without throwing, and same-collection navigation trivially passes collection-B schema validation, so nothing blocks the write. The secondary variant also verifies: openDoc (L146-171) starts unsequenced fetches with no cancellation or stale-response guard, so out-of-order responses display one document's bytes under another's route and repeat the cross-write on the next save. Silent cross-document data destruction justifies HIGH_BUG.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-10)
