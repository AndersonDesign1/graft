---
"@usegraft/auth": patch
"@usegraft/cli": patch
"@usegraft/contracts": patch
"@usegraft/core": patch
"@usegraft/mcp": patch
"@usegraft/registry": patch
"@usegraft/sdk-next": patch
"@usegraft/sdk-react": patch
"@usegraft/studio": patch
---

Dependency floors raised to versions without known advisories.

`main` was carrying 34 Dependabot alerts, and a range-respecting update across
the workspace clears 23 of them: `next` 16.2.9 → 16.3.3 (nine alerts on its
own), `hono` 4.12.27 → 4.13.5, `postcss` 8.4.31 → 8.5.23, plus `astro`, `tar`,
`sharp`, `svgo`, `@astrojs/vercel` and `@hono/node-server`.

Declared ranges move with the lockfile, which is what makes this a change worth
a version rather than a lockfile refresh: `zod` `^4.1.0` → `^4.5.4`, `jose`
`^6.0.0` → `^6.2.10`, `jiti` `^2.4.0` → `^2.7.0` and the React type packages.
Every one is a floor raised inside the same major. **No peer range changed** —
`sdk-next` still peers `next >=15.0.0`, `sdk-react` still peers `react >=18.0.0`
— so nothing a consumer already resolves stops resolving.

Eleven alerts survive this and are deliberately not addressed here. Two are
`vitest`, pinned at `^2.1.9` against a fix in `3.2.6`: a major upgrade of the
test framework is its own change, not a line in a dependency bump. The other
nine are transitive versions their parents pin — `esbuild` now resolves
`0.28.1` and `0.28.2` alongside `0.18.20`, `0.21.5`, `0.25.12` and `0.27.7`,
and only `pnpm.overrides` dislodges those. Each override is a compatibility bet
and belongs where it can be argued one at a time.
