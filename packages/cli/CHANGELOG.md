# @usegraft/cli

## 0.1.1

### Patch Changes

- 6737b5b: `graft --version` reported `0.0.0` instead of the released version.

  The version was a hardcoded constant that changesets never touched, and the test
  asserted `toContain("0.0.0")` — so it passed _because_ of the bug. The version is
  now read from the manifest at runtime, and the test asserts against that value
  rather than a literal.

  - @usegraft/assets@0.1.1
  - @usegraft/auth@0.1.1
  - @usegraft/compiler@0.1.1
  - @usegraft/content-migrations@0.1.1
  - @usegraft/contracts@0.1.1
  - @usegraft/core@0.1.1
  - @usegraft/db@0.1.1
  - @usegraft/mcp@0.1.1
  - @usegraft/registry@0.1.1
  - @usegraft/studio@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [8d8eda0]
  - @usegraft/core@0.1.0
  - @usegraft/auth@0.1.0
  - @usegraft/compiler@0.1.0
  - @usegraft/content-migrations@0.1.0
  - @usegraft/mcp@0.1.0
  - @usegraft/studio@0.1.0
  - @usegraft/assets@0.1.0
  - @usegraft/contracts@0.1.0
  - @usegraft/db@0.1.0
  - @usegraft/registry@0.1.0
