# 0002 — Security defaults fail closed, and misconfiguration fails at startup

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

`createGraftMcpHandler` took `requireActor?: boolean` defaulting to **off**, on
a handler whose own documentation advertises embedding it in "a Next.js route, a
self-host container, Vercel Fluid, or a Worker". Both shipped examples wired it
to an environment variable. A deployment missing that variable served
`write_content`, `put_asset`, `delete_content` and `decide_approval` to anyone
who found the URL.

`graft serve` had the same shape, plus a warning whose condition tested whether
an actor _resolver_ was configured rather than whether authentication was
_required_ — so setting `GRAFT_DEV_TOKEN` silenced the warning while anonymous
callers kept reaching `decide_approval`.

## Decision

Insecure options are phrased as opt-ins to insecurity, never opt-ins to safety:
`allowAnonymous`, not `requireActor`. They default to off.

Where a safe default can be derived rather than configured, derive it.
`graft serve` decides from the bind host: anonymous MCP on loopback, refused
anywhere else. Off loopback it takes a deliberate, warned-about
`GRAFT_MCP_ALLOW_ANONYMOUS=1`.

**A configuration that cannot be secure fails at construction, not per request.**
Building an MCP handler with neither an actor resolver nor an explicit
`allowAnonymous` throws. A deployer who forgets gets a startup crash carrying a
fix line, which is the one signal that cannot be missed.

Warnings test what is enforced, never what is configured.

## Premise

The people deploying Graft do not read every option before shipping, and a
default is what most deployments will run. This holds for as long as Graft is
something you embed rather than something you operate full-time.

## Consequences

- Breaking for anyone relying on the old defaults, which is the point.
- Local development needs one explicit flag in the examples. Accepted: the cost
  falls on the safe case, not the exposed one.
- `GRAFT_MCP_REQUIRE_AUTH` is retired rather than kept alongside the new name.
  Two names for one concept is how the warning condition drifted from the thing
  it was meant to describe.
