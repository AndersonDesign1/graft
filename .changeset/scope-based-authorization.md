---
"@usegraft/studio": minor
"@usegraft/mcp": minor
"@usegraft/cli": minor
---

Authorization is per-route and scope-based. Being authenticated is no longer
enough to reach operator-only surfaces.

The Studio's `authorize` was `(request) => boolean` — an interface too narrow to
express "may this actor do _this particular thing_", so callers invented their
own policy. What `graft serve` invented was `actor.kind !== "anonymous"`, which
admits every agent: `GRAFT_DEV_TOKEN` mints `{ kind: "agent" }` and OIDC issuers
default to the same. Any agent holding a normal runtime token could approve
destructive operations, write documents, commit, and revert.

MCP had the mirror problem: scopes were consulted only inside `run_function`'s
access rules, so `write_content`, `put_asset`, `delete_content` and
`decide_approval` were available to any authenticated caller whatever their
token permitted.

**Breaking:**

- `StudioApiOptions.authorize` is replaced by `authenticate`, which returns a
  `StudioPrincipal` (`{ kind, id, scopes }`) or `null` to refuse.
- Studio routes require scopes: `studio:read` for reads, `studio:write` for
  mutations, `approvals:decide` for the approval decision. The requirement is
  computed in one place, so a new route cannot be added without one.
- MCP `write_content`, `put_asset` and `delete_content` require `content:write`;
  `decide_approval` requires `approvals:decide`.
- Approval decisions made through an authenticated Studio are attributed to the
  caller, not the mount-time identity.
- `graft mcp` grants `content:write` locally (it runs on the operator's own
  machine) but deliberately not `approvals:decide`, so the CLI requesting and
  `graft approve` deciding remain different identities.
- The landing-page example stops granting every self-registered account
  `submissions:read commerce:orders:read commerce:orders:write`. Scopes now come
  from a `GRAFT_OPERATOR_EMAILS` allowlist; one free signup previously dumped
  every contact submission and could mark arbitrary orders paid.
