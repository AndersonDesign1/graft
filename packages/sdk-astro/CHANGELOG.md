# @usegraft/sdk-astro

## 0.2.1

### Patch Changes

- 36d6045: Fix the install command on every package page. `npx graft` resolves to an
  unrelated package on npm, so the documented way to run the CLI without
  installing fetched the wrong thing. It is `npx @usegraft/cli` everywhere now,
  with a note saying why the scoped name is needed.

  Fix the `graftRoute` example in `@usegraft/sdk-astro`. It showed a config
  object, but `graftRoute` takes the handler, so the snippet did not compile.

  Document the static index in the SDK READMEs. `createClient` and `createGraft`
  both accept `index` from `openStaticIndex(".graft/index.db")`, which is what
  `graft init` scaffolds by default, and none of the READMEs mentioned it. Every
  read example now shows where its `db` or `index` comes from instead of leaving
  the handle undefined.

  `@usegraft/sdk-sveltekit` gets the same treatment in the repository, but it
  is still `private` and so cannot be named in a changeset. Its README ships with
  whatever release first publishes it.

- Updated dependencies [36d6045]
  - @usegraft/sdk-core@0.2.1

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

- Updated dependencies [f423a6e]
  - @usegraft/sdk-core@0.2.0

## 0.1.1

### Patch Changes

- @usegraft/sdk-core@0.1.1

## 0.1.0

### Patch Changes

- @usegraft/sdk-core@0.1.0
