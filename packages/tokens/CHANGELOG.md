# @usegraft/tokens

## 1.0.0-beta.9

## 1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- f8c14f4: The light scheme moves from ivory to chalk paper. `--paper-0` is now `oklch(0.992 0.002 95)` (about `#fdfcfb`) and `--paper-2` is `oklch(0.966 0.003 95)` (about `#f4f4f1`), on the same warm hue as the ink, so light mode reads white without going cold. Light borders are lighter to match (`--border` 0.11, `--border-strong` 0.24). Dark mode does not change. Anything that reads `--paper`, `--background` or `--border`, including Studio's light preview, picks this up with no code change.

  New type-role tokens set size, leading and tracking together: `--type-title`, `--type-section`, `--type-subsection`, `--type-lede` and `--type-meta`, each with its `--leading-*` and, for headings, `--tracking-*`. `--weight-regular`, `--weight-medium` and `--weight-semibold` name the only three weights in use. `--type-wordmark` and `--tracking-wordmark` set the docs top-bar "graft." wordmark. The landing page keeps its own wordmark for now.

- b146045: Studio's frame and popups now match the docs. A 56px top bar runs across the
  page with the `graft. / Studio` wordmark and the branch on the left, search
  centred, and Commit (or Publish) and the account menu on the right. The
  sidebar sits under it on the page colour. Below 768px the sidebar opens from a
  menu button.

  Popups share one material: the elevated surface and a 10px radius, opening in
  160ms and closing in 100ms. Dialogs and sheets add a dimmed backdrop with no
  blur and a visible close button; the command palette opens instantly and closes
  on Escape or a choice. Deleting or discarding asks in a confirm dialog that starts on
  Cancel and names the action ("Delete post") in place of the browser's
  `confirm()`. The command palette shows its keys, menus carry icons, toasts
  come one at a time, and committing ends with a plain check instead of an
  animation.

  `@usegraft/tokens` adds `--scrim`, the colour behind a dialog or sheet.

## 1.0.0-beta.6

## 1.0.0-beta.5

## 1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- f92b97c: Clearer wording for two error explanations. `NEEDS_DATABASE` now says the project runs on the static storage engine and the feature needs the Postgres engine, instead of "static index mode" and "Postgres-tier". The registry entry now says "core registry" instead of "Tier-1 registry". `@usegraft/tokens` adds a `--measure` token for the reading width of prose. It also defines `--space-5`, which eight declarations already used while it was undefined, so callouts and other spaced elements lost their padding. Callouts get their own note and warning hues instead of reusing the accent, and `--n-10` names pure white for text on the primary color in dark mode.

## 1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

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

## 1.0.0-beta.0

## 0.2.0

### Minor Changes

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

## 0.1.1

## 0.1.0
