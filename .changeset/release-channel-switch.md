---
"@usegraft/cli": patch
---

Add a real release channel switch, and one GitHub Release per version.

Canary was doing a job it cannot do. A snapshot is `0.0.0-canary-<timestamp>`
forever: it sorts _below_ every real release, npm never offers it as an
upgrade, and there is no path from it to a stable version — you hand someone a
build and they pin a timestamp. It answers "does this commit work?", not "is the
next version ready?"

Beta is changesets prerelease mode: `1.0.0-beta.0` → `1.0.0-beta.1` → `1.0.0`.
A tester runs `npm i @usegraft/cli@beta` once and gets each new beta as an
ordinary upgrade, while `latest` stays where it is.

```sh
pnpm release:beta-enter   # commit .changeset/pre.json
pnpm release:beta-exit    # graduate to stable
pnpm release:channel      # which channel am I on?
```

release.yml's own comment named the reason pre mode was avoided: the state is
committed, feat/core takes every ordinary push, and nothing would remind you to
leave. So the release job now prints the active channel before anything
publishes, and the canary path refuses to run in pre mode and says why. Being
in beta is something the log tells you, not something you remember.

**One release per version.** `fixed` makes all 21 packages one product on one
version line, but changesets/action tags and releases each separately — 21 tags
and 21 GitHub Releases per version, with one arbitrarily flagged "Latest"
because GitHub picks by recency. Tags fragmented the history instead of
grouping it. A `v<version>` release now collects every package's changelog
entry. The per-package tags stay, because npm and provenance point at them.
