# @usegraft/content-migrations

## 1.0.0-beta.2

### Patch Changes

- @usegraft/contracts@1.0.0-beta.2
- @usegraft/core@1.0.0-beta.2

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

- Updated dependencies [27b8468]
- Updated dependencies [52fc3e6]
  - @usegraft/contracts@1.0.0-beta.1
  - @usegraft/core@1.0.0-beta.1

## 1.0.0-beta.0

### Patch Changes

- Updated dependencies [2561b47]
- Updated dependencies [15568eb]
- Updated dependencies [655e4d1]
- Updated dependencies [e2829b4]
- Updated dependencies [a442299]
  - @usegraft/core@1.0.0-beta.0
  - @usegraft/contracts@1.0.0-beta.0

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

### Patch Changes

- Updated dependencies [61b9ac4]
- Updated dependencies [e0d4eda]
- Updated dependencies [f423a6e]
- Updated dependencies [ed103a8]
- Updated dependencies [301c817]
- Updated dependencies [d6cbc3d]
  - @usegraft/contracts@0.2.0
  - @usegraft/core@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/contracts@0.1.1
- @usegraft/core@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/contracts@0.1.0
