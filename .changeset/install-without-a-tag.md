---
"@usegraft/assets": patch
"@usegraft/auth": patch
"@usegraft/cli": patch
"@usegraft/compiler": patch
"@usegraft/content-api": patch
"@usegraft/content-migrations": patch
"@usegraft/contracts": patch
"@usegraft/core": patch
"@usegraft/db": patch
"@usegraft/mcp": patch
"@usegraft/mdx-safety": patch
"@usegraft/registry": patch
"@usegraft/sdk-astro": patch
"@usegraft/sdk-core": patch
"@usegraft/sdk-next": patch
"@usegraft/sdk-react": patch
"@usegraft/sdk-react-router": patch
"@usegraft/sdk-sveltekit": patch
"@usegraft/sdk-tanstack-start": patch
"@usegraft/studio": patch
"@usegraft/tokens": patch
---

Install commands drop `@beta`. A plain install is now the right install.

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
