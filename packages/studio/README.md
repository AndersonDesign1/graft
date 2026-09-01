# @usegraft/studio

> The optional editing UI. Headless-first: every operation it performs also exists on MCP and the CLI.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

The Studio is opt-in, Drizzle-style. Nothing depends on it, and the UI is only a client of the same OpenAPI surface an agent uses.

## Install

```bash
npm i @usegraft/studio@beta
```

Or just run `graft studio` from [`@usegraft/cli`](https://www.npmjs.com/package/@usegraft/cli).

## Mount it

```ts
import { createStudioHandler } from "@usegraft/studio";

const handler = createStudioHandler({
  db,
  collections,
  contentDir,
  defaultBranch: "main",
  decider: { kind: "human", id: operatorEmail },
  authenticate,
});
```

`decider` is resolved when the Studio is mounted, never from the request. It is the value the separation-of-duties check compares against the requester, so a request that could name it could always approve its own destructive operation.

## Authorization

Routes live in a table where `scope` is a required column, not something derived from the HTTP method. A route cannot be added without deciding what it permits, and the whole authorization surface reads as one column. Reading a preview and rewriting content are different scopes even when they share a path.

## Local safety

Host validation and cross-origin refusal are on by default, because a Studio bound to loopback is still reachable from a page in your browser.

## OpenAPI

`STUDIO_OPENAPI` is the served spec. The UI is generated against it, which is what keeps headless parity honest.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/studio/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/main/SECURITY.md)
