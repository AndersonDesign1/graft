# 0003 — Authorization is a scope per route, not a boolean per handler

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

The Studio API's authorization was `authorize: (request) => boolean`. One
boolean cannot express "may this actor do _this particular thing_", because it
is decided once per handler and every route behind it differs. So the caller
invented a policy, and what `graft serve` invented was
`actor.kind !== "anonymous"` — which admits every agent, since `GRAFT_DEV_TOKEN`
and OIDC issuers both mint agent-kind actors. Any agent holding an ordinary
runtime token reached the approve/deny surface.

MCP had the mirror of it: scopes were consulted only inside `run_function`'s
access rules, so `write_content`, `put_asset`, `delete_content` and
`decide_approval` ran unchecked for any authenticated caller.

## Decision

A seam that carries an authorization question carries enough to answer it.
Studio's `authenticate` returns a `StudioPrincipal` (`{ kind, id, scopes }`) or
`null`, and each route declares a required scope as a **field on the route**, so
a route cannot be added without deciding what it permits.

Three scopes, separated because the privileges genuinely differ:
`studio:read`, `studio:write`, `approvals:decide`. A credential that may commit
content has no business deciding the human gate.

MCP tools take the same scopes: `content:write` for authoring and asset upload,
`approvals:decide` for the gate.

## Premise

Scopes reach Graft from a credential the deployment controls — an OIDC `scope`
claim or `GRAFT_DEV_SCOPES` — and a deployment that hands the same scopes to
every principal has made that choice knowingly.

This premise was **false in our own example** and that was the bug: the
landing-page stamped every self-registered account with
`submissions:read commerce:orders:read commerce:orders:write`, so one free signup
was a privileged credential. Scopes there now come from an allowlist.

## Consequences

- Breaking: `StudioApiOptions.authorize` is replaced by `authenticate`.
- A deployment whose tokens lack the new scopes loses Studio write access until
  it mints them. Intended: that is the escalation being closed.
- `graft studio` grants its dev token the full operator set, because that
  command is the operator's own tool rather than an agent surface.
