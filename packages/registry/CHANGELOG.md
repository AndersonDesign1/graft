# @usegraft/registry

## 1.0.0-beta.1

### Patch Changes

- 27b8468: Dependency floors raised to versions without known advisories.

  `main` was carrying 34 Dependabot alerts, and a range-respecting update across
  the workspace clears 23 of them: `next` 16.2.9 → 16.3.3 (nine alerts on its
  own), `hono` 4.12.27 → 4.13.5, `postcss` 8.4.31 → 8.5.23, plus `astro`, `tar`,
  `sharp`, `svgo`, `@astrojs/vercel` and `@hono/node-server`.

  Declared ranges move with the lockfile, which is what makes this a change worth
  a version rather than a lockfile refresh: `zod` `^4.1.0` → `^4.5.4`, `jose`
  `^6.0.0` → `^6.2.10`, `jiti` `^2.4.0` → `^2.7.0` and the React type packages.
  Every one is a floor raised inside the same major. **No peer range changed** —
  `sdk-next` still peers `next >=15.0.0`, `sdk-react` still peers `react >=18.0.0`
  — so nothing a consumer already resolves stops resolving.

  Eleven alerts survive this and are deliberately not addressed here. Two are
  `vitest`, pinned at `^2.1.9` against a fix in `3.2.6`: a major upgrade of the
  test framework is its own change, not a line in a dependency bump. The other
  nine are transitive versions their parents pin — `esbuild` now resolves
  `0.28.1` and `0.28.2` alongside `0.18.20`, `0.21.5`, `0.25.12` and `0.27.7`,
  and only `pnpm.overrides` dislodges those. Each override is a compatibility bet
  and belongs where it can be argued one at a time.

- 52fc3e6: Install commands drop `@beta`. A plain install is now the right install.

  Every README said `npm i @usegraft/<pkg>@beta`, because `latest` pointed at
  `0.2.0` while the docs described `1.0.0-beta.x`. Writing the tag into 22 files
  treated the symptom. The defect was the dist-tag: `latest` is what a bare
  install resolves, and it resolved to somewhere nobody should land.

  `latest` now points at the prerelease across all 21 published packages, and the
  `0.x` line is deprecated, so the tag has nothing left to do. `install-tag.mjs`
  inverts with it — it strips tags instead of adding them, and CI fails if one
  comes back.

  The half a script cannot check is the registry. Publishing a prerelease while
  `latest` sits on something older reopens the original bug and nothing in the
  repo will notice. That property is kept by moving the tag at release, and it is
  written down in the script rather than assumed.

- Updated dependencies [27b8468]
- Updated dependencies [52fc3e6]
  - @usegraft/contracts@1.0.0-beta.1

## 1.0.0-beta.0

### Patch Changes

- Updated dependencies [15568eb]
- Updated dependencies [e2829b4]
  - @usegraft/contracts@1.0.0-beta.0

## 0.2.0

### Minor Changes

- e0d4eda: Field builders can bound what they accept, and query limits are clamped
  server-side.

  `FieldOptions` carried only `optional` and `description`, so every authored
  string and every public form input compiled to a bare `z.string()` and was
  written verbatim into an unbounded jsonb column. A single anonymous request
  could store megabytes; an unbounded quantity multiplied by a price silently
  exceeded `Number.MAX_SAFE_INTEGER` and stored a wrong total rather than being
  rejected.

  **New options:** `maxLength` (string/text), `min` / `max` / `int` (number),
  `pattern` (string/text), and `maxItems` on `field.array`.

  **Breaking:**

  - `listRecords` clamps `limit` to `MAX_RECORD_LIMIT` (500) and coerces nonsense
    values to the default. It previously passed a caller-supplied number straight
    to `LIMIT`, so a public query could ask for a billion rows — or a negative
    one, which made Postgres error.
  - `listRecords` gains `match`, which filters on `data` fields **in SQL**.
    Filtering after the row cap is a correctness bug, not just a slow path:
    non-matching rows still consume the window. `listComments` filtered
    `approved && pageSlug` in JavaScript afterwards, so posting enough unapproved
    comments emptied every approved comment on every page, silently.

  The bundled `comments` and `commerce` primitives now bound every input,
  `placeOrder` caps `items` at 100, and `loadProducts` batches the catalog lookup
  into one `inArray` query instead of one round-trip per slug — that loop ran
  _before_ unknown slugs were rejected, so a request full of bogus slugs held a
  pooled connection for thousands of serial queries and only then failed
  validation.

  `products.currency` is constrained to three letters, so one malformed product
  can no longer take down the catalog page via `Intl.NumberFormat`.

- f423a6e: Every package ships a README, a description, keywords and a LICENSE.

  `0.1.1` published sixteen packages with no README and, for fourteen of them, no
  `description` either. On npm that renders as a blank page and an unsearchable
  listing: `description` is the line npm search shows, and without keywords the
  packages are findable only by exact name.

  Each README says what the package is, how to install it, and shows one real
  example using its actual exports. The security-relevant ones state their
  defaults plainly, because "MdxBody refuses executable MDX by default" is
  something a reader should not have to find in an ADR.

  `LICENSE` is now copied into each package. `files: ["dist"]` does not exclude
  `README.md` or `LICENSE` (npm always packs those), but a licence file only ships
  if it exists in the package directory, and the root one does not count.

- 92fe85e: One path-containment helper, and it refuses symlinks.

  `resolveContained(root, path)` (new, in `@usegraft/compiler`) checks the bytes
  _and_ the filesystem. Lexical containment — `resolve` plus a prefix check —
  only answers "does this string stay under the root", which a symlink **inside**
  the root silently defeats: `docs/notes.mdx -> ~/.ssh/id_rsa` passes every string
  test and `readFileSync` then follows it. Git can commit symlinks, so a cloned
  template can plant one.

  **Breaking:**

  - MCP `put_asset` no longer reads arbitrary server paths. Its `path` argument
    requires the new `localUploadRoot` option, which only `graft mcp` sets (to the
    project directory) — every remote mount refuses it. Previously the raw string
    went to `readFileSync`, the bytes were stored under a caller-chosen key, and
    the response included a fetchable URL, so one call read `.env` off the server.
  - Studio `writeDocument` validates the slug against `SLUG_RE` and contains the
    resulting path. `parseDocument`'s existing check did not help: it validates
    `basename(sourcePath)`, which strips exactly the `..` segments that make a
    path dangerous.
  - `loadItem` validates the item name before joining it onto the registry root.
    `describe_item` passed a raw MCP argument through, and the three error
    branches were distinguishable — a filesystem existence oracle.
  - `safeContentPath` now refuses symlinks, so a hostile repository can no longer
    leak files through the changes-diff endpoint.

  Also fixes `looksBinary`, which read an entire file into memory to inspect its
  first 8KB — one large file made every diff render allocate all of it.

  `SLUG_RE` is now exported from `@usegraft/compiler`.

### Patch Changes

- d6cbc3d: Thirteen self-contained defects, led by a data-loss bug in the editor.

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

- Updated dependencies [61b9ac4]
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
  - @usegraft/contracts@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/contracts@0.1.1

## 0.1.0

### Patch Changes

- @usegraft/contracts@0.1.0
