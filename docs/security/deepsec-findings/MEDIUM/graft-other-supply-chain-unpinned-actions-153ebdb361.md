# [MEDIUM] Release workflow with id-token/contents write permissions runs unpinned third-party actions

**File:** [`.github/workflows/release.yml`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/.github/workflows/release.yml#L52-L87) (lines 52, 63, 73, 87)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-supply-chain-unpinned-actions`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The release workflow grants contents: write, pull-requests: write, and id-token: write (L25-28), then executes four actions referenced by mutable major tags: actions/checkout@v7 (L52), pnpm/action-setup@v6 (L63), actions/setup-node@v7 (L73), and changesets/action@v1 (L87). Two of these are third-party (pnpm org, changesets org). A tag-move compromise of either would run attacker code inside a job that can mint npm trusted-publishing OIDC tokens (NPM_CONFIG_PROVENANCE flow, L28/L36) and publish attacker-controlled versions of every @usegraft/* package — compromising all downstream consumers. Exploitation requires an upstream compromise as a precondition, which is exactly what SHA pinning defends against; the workflow's own comments demonstrate careful threat modeling elsewhere, making the missing pinning notable. Minor related hardening: id-token: write is scoped to the whole job while only the publish step needs it; splitting version/publish into separate jobs with distinct permission sets would reduce standing privilege.

## Recommendation

Pin all four actions to full commit SHAs. Consider splitting into two jobs: a version job with contents/pull-requests write (no id-token) and a publish job with only id-token: write.

## Revalidation

**Verdict:** true-positive

Confirmed at the exact cited lines: checkout@v7 (L52), pnpm/action-setup@v6 (L63), setup-node@v7 (L73), changesets/action@v1 (L87), under job-level permissions contents:write, pull-requests:write, id-token:write (L25-28) with NPM_CONFIG_PROVENANCE publishing. A compromise that moves any of these tags — two of which are third-party (pnpm org, changesets org) — runs attacker code inside a job capable of minting npm trusted-publishing OIDC tokens and publishing attacker-controlled @usegraft/* tarballs to every downstream consumer, the highest-consequence outcome available in this repo. Unlike ci.yml there are real credentials here (id-token:write is precisely what the publish flow validates), so the missing pinning directly undermines the workflow's otherwise careful threat model (the file documents pnpm#11513 and registry-url hazards in detail, yet leaves refs mutable). Exploitation still requires an upstream compromise as a precondition, which is why MEDIUM rather than HIGH is appropriate; SHA pinning is the standard control and its absence is verified.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-25)
