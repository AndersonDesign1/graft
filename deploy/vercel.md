# Graft on Vercel (embedded topology)

Vercel's compute is request-scoped (Functions/Fluid) — not a container host —
so Graft deploys **embedded**: your Next app mounts the same stateless
handlers the container serves, and `examples/landing-page` is the working
reference. There is no Graft server to operate; the app is the runtime.

## What the app mounts

| Route file                    | Handler                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `app/api/fn/[name]/route.ts`  | `createFunctionsHandler` (typed functions: access, audit, limits, approvals) |
| `app/api/mcp/route.ts`        | `createGraftMcpHandler` (remote agents over Streamable HTTP)                 |
| `app/api/revalidate/route.ts` | ChangeSet → cache-tag invalidation webhook (optional)                        |

Plus `withGraft()` in `next.config.ts` (ships the registry server-external so
`list_registry`/`describe_item` work in the deployed app).

## Data

- **Postgres: Neon.** The codebase is pooler-aware (`ssl=require`,
  `prepare=false` are derived from the URL). Set `DATABASE_URL` in Vercel env.
- **Assets: R2.** Set `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` /
  `S3_BUCKET` (+ `S3_PUBLIC_URL` for stable public asset URLs).

## Identity

Set `GRAFT_MCP_REQUIRE_AUTH=1` for any publicly reachable deployment. Tokens:
`GRAFT_DEV_TOKEN` for a static bearer, or verified OIDC — the example hosts
Better Auth and mints JWTs the resolver verifies; an external IdP
(Vercel Connect / Passport shape) plugs into the same `createActorResolver`
issuers list.

## Compile is a build step, not a runtime step

The deployed filesystem is read-only, so authored content projects at deploy
time. Wire it into the build:

```jsonc
// package.json
"scripts": { "build": "graft compile && next build" }
```

Every push then: git commit (authoritative) → compile → typed reads serve the
new index. MCP `write_content`/`delete_content` need a writable content tree,
so remote authoring runs against dev/self-host — the deployed Vercel surface
is functions + reads + search + registry browse.

## Harden (recommended)

Same recipe as the containers ([`deploy/README.md`](./README.md)): create
`graft_runtime` on Neon, `graft harden graft_runtime` as the operator, and put
the runtime role's URL in Vercel's `DATABASE_URL`. Vercel exposes the same env
at build and runtime, and the build-step compile needs the operator
credential — so add a second variable and let the build script pick it:

```jsonc
// package.json — compile as operator, serve as runtime
"scripts": { "build": "DATABASE_URL=$GRAFT_OPERATOR_DATABASE_URL graft compile && next build" }
```

Humans keep the operator URL for `graft approve`. A leaked or misused runtime
credential cannot approve its own destructive calls — `UPDATE approvals` is
denied by Postgres itself. One caveat: `graft harden` grants Graft's tables
only; if the app hosts its own (the example's Better Auth tables, say), grant
those to the runtime role separately.
