---
"@usegraft/cli": patch
---

`npx @usegraft/cli init` in the README could run a copy from weeks ago.

`npx`, `pnpm dlx` and `bunx` fetch a package, run it, discard the process — and
keep the tarball. So a bare runner command re-runs whatever it cached last,
without saying so. That is the failure the dist-tag work was meant to close,
arriving by another road: the registry is right and the machine is stale.

`@latest` is what tells them to check, and it is why `npx create-next-app@latest`
is written that way everywhere. The reason is the cache, not decoration.

`npm i -D @usegraft/cli` stays bare. A bare install already resolves `latest` —
that is what it means — so the tag would add a word that changes nothing, and a
tag that is load-bearing on some lines and noise on others teaches a reader to
skim past tags where it matters. `scripts/install-tag.mjs` now enforces both
halves: `@latest` on the ephemeral three, absent on the installers.
