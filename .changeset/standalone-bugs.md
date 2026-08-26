---
"@usegraft/studio": patch
"@usegraft/core": patch
"@usegraft/auth": patch
"@usegraft/registry": patch
"@usegraft/db": patch
---

Thirteen self-contained defects, led by a data-loss bug in the editor.

- **The editor wrote one document's content into another document's file.**
  `persist` took `collection`/`slug` from the current route closure while taking
  the bytes from a ref. On an A → B navigation React re-renders with route=B
  before the pending flush runs, so A's edits were written to B's path,
  destroying it — and the toast said "Saved B/B". Identity now comes from the
  same snapshot as the content, via a new `buildSavePayload` that takes it as an
  argument, which makes the mismatch unrepresentable. Document loads are
  sequenced so out-of-order responses cannot show one document under another's
  route.
- `updateRecord` read, merged and wrote with no lock, so two concurrent callers
  both merged over the same baseline and the second silently erased the first.
  Now one transaction with `SELECT … FOR UPDATE`, and the "unreachable"
  `throw new Error` is a real `DOCUMENT_NOT_FOUND`.
- A malformed URL escape white-screened the Studio (`parseHash` runs in a
  `useState` initialiser, so the `URIError` threw during first render) and
  turned Studio asset and route-id requests into misleading 500s.
- The compiled static index briefly did not exist: `rmSync` then `renameSync`
  left a window where readers got `STATIC_INDEX_NOT_FOUND`, and a crash between
  them destroyed the artifact. Now an atomic rename, falling back only on
  Windows.
- Data migrations persisted the raw transform output instead of the validated
  result, so Zod defaults and coercions never reached the stored rows, and
  compared with key-order-sensitive `JSON.stringify` against jsonb that
  normalises key order — rewriting identical rows.
- The generated `graft/index.ts` barrel emitted duplicate imports when two
  filenames collapsed onto one identifier (`my-mod.ts` and `myMod.ts`), in a
  file marked "do not edit". It now refuses and names both offenders.
- `graft dev` kept watching the original content directory after a config reload
  moved it, so every later save was invisible.
- OIDC tokens without a `sub` claim authenticated as an actor with no id.
  `requiredClaims: ["sub"]` now rejects them.
- `applyPlan` trusted a conflict snapshot taken when the plan was built; it now
  re-checks disk immediately before each write.
- A `??` chain in the pages-description migration short-circuited on an empty
  string, so the documented title fallback was never reached.
- All four GitHub Actions are pinned to commit SHAs, and the release workflow's
  `id-token: write` is scoped to the publish job rather than the whole file.
