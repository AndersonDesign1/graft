---
"@usegraft/sdk-next": minor
"@usegraft/mcp": patch
---

**BREAKING:** `@usegraft/sdk-next` no longer supports Next.js 14. Its peer range is `next@^15.0.0 || ^16.0.0`, and CI no longer builds a Next.js 14 app. Next.js 14 gets no security fixes, and its last release, 14.2.35, has two critical remote code execution advisories that will not be fixed on 14.

The adapter still runs on 14.2, so a project that cannot upgrade yet keeps working. pnpm and bun print a peer warning on install, and npm refuses unless you pass `--legacy-peer-deps`. `withGraft` now says that 14 is not supported and links to "Run Graft on Next.js 14" in the Next.js guide, which lists what differs on 14. Upgrade to 15.5.24 or 16.3.3 or later.

The MCP `list_packages` tool says `@usegraft/sdk-next` is for Next.js 15 or 16.
