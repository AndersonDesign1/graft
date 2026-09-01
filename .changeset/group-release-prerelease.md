---
"@usegraft/cli": patch
---

Mark a grouped release as a prerelease when the version has one.

`v1.0.0-beta.0` was created unmarked, which leaves GitHub free to show it as the
repository's Latest release — telling every visitor the beta is the current
version, the exact confusion a beta channel exists to prevent. changesets marks
its per-package releases; the grouped one now does too.
