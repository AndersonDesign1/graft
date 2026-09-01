# @usegraft/auth

> Graft verifies identity; it does not mint it. Turn a request into a scoped actor by verifying bearer JWTs against trusted issuers.

Part of [Graft](https://github.com/AndersonDesign1/graft), a CMS built so an AI agent is the primary operator.

## Install

```bash
npm i @usegraft/auth@beta
```

## Resolve an actor

```ts
import { createActorResolver, betterAuthIssuer } from "@usegraft/auth";

const resolveActor = createActorResolver({
  issuers: [betterAuthIssuer("https://example.com")],
});
```

Hand that to `graft serve`, the MCP handler, or the functions handler. It verifies the bearer JWT against the issuer's JWKS via OIDC discovery and returns a `FunctionActor` carrying a stable id and the scopes from the standard `scope` claim.

Because it verifies rather than issues, an external IdP drops in unchanged. A Better Auth instance your app hosts and an enterprise IdP take the same path.

## Require scopes

```ts
import { requireScopes } from "@usegraft/auth";

export const listSubmissions = defineFunction({
  name: "listSubmissions",
  authorize: requireScopes("submissions:read"),
  // …
});
```

Being signed in earns nothing. An account gets scopes because something granted them, which is the whole point: open sign-up plus implicit scopes means one free registration reads everything.

## Environment

`GRAFT_TRUSTED_ISSUERS` for OIDC issuers, `GRAFT_DEV_TOKEN` and `GRAFT_DEV_SCOPES` for a static local identity. Anonymous MCP is refused unless `GRAFT_MCP_ALLOW_ANONYMOUS=1`, which nothing sets for you.

---

MIT. [Repository](https://github.com/AndersonDesign1/graft) · [Changelog](https://github.com/AndersonDesign1/graft/blob/main/packages/auth/CHANGELOG.md) · [Security policy](https://github.com/AndersonDesign1/graft/blob/main/SECURITY.md)
