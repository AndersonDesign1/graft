# [MEDIUM] GitHub Actions pinned to mutable major tags instead of commit SHAs

**File:** [`.github/workflows/ci.yml`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/.github/workflows/ci.yml#L18-L24) (lines 18, 21, 24)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** low  •  **Slug:** `other-supply-chain-unpinned-actions`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

All three actions are referenced by mutable major-tag refs: actions/checkout@v7 (L18), pnpm/action-setup@v6 (L21), actions/setup-node@v7 (L24). If any upstream repo/tag were compromised and the tag moved (the technique behind the tj-actions/changed-files supply-chain incident), arbitrary attacker code would execute in CI on every push to main/feat/core and every pull_request. Impact here is bounded — ci.yml declares no permissions block and uses no secrets, so exposure is limited to the default GITHUB_TOKEN and runner access — but pnpm/action-setup is third-party (pnpm org) and the pattern provides no tamper-evidence.

## Recommendation

Pin each action to a full-length commit SHA (e.g. actions/checkout@<sha>) with a version comment. Optionally restrict third-party actions via repository Actions allowlist policy.

## Revalidation

**Verdict:** true-positive

Verified verbatim: ci.yml references actions/checkout@v7 (L18), pnpm/action-setup@v6 (L21), actions/setup-node@v7 (L24) — all mutable major tags with zero tamper-evidence, so a tag-move compromise (the tj-actions/changed-files technique) would execute attacker code on every push and pull_request. There is no mitigation in the repo: no SHA pinning, no permissions block (so GITHUB_TOKEN uses repo defaults, potentially read/write on pushes), no third-party action allowlist. The exploit is conditional on an upstream compromise, but that precondition is inherent to the vulnerability class — the whole point of SHA pinning is to remove trust in upstream tag mutability. Impact is genuinely bounded as the finding itself states: the workflow uses no secrets (BETTER_AUTH_SECRET is a build-only throwaway), runs no deploys, and fork PRs get a read-only token, leaving cache/artifact poisoning and source exfiltration as the realistic blast radius. That keeps this at MEDIUM rather than higher; it is a real hardening gap, not a false positive.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-25)
