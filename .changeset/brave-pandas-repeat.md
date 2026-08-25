---
"@usegraft/cli": patch
---

`graft --version` reported `0.0.0` instead of the released version.

The version was a hardcoded constant that changesets never touched, and the test
asserted `toContain("0.0.0")` — so it passed *because* of the bug. The version is
now read from the manifest at runtime, and the test asserts against that value
rather than a literal.
