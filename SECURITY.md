# Security

## Reporting a vulnerability

Email **josanderson25@gmail.com** with "graft security" in the subject. Include
what you did, what happened, and which version or commit you were on. Please do
not open a public issue for anything exploitable.

You will get an acknowledgement within 72 hours and an assessment within a week.

## What Graft assumes

These are the assumptions the design rests on. A deployment that breaks one is
outside what the controls below cover.

- **Git is authoritative for authored content**, and commit access is a trusted
  privilege. Content in the repository has been through whatever review the
  repository requires.
- **Agents are semi-trusted.** They may author content and invoke functions.
  They may not decide their own destructive operations, and no agent runtime
  token should carry `approvals:decide`.
- **The operator credential is separate from the runtime credential.** Graft
  works single-credential, and `graft harden <role>` splits them. The container
  applies the split by default wherever it owns its own database. The split is
  defence in depth beneath the application-level controls, not a substitute.

## What is enforced

| Control                                                                 | Where                                  |
| ----------------------------------------------------------------------- | -------------------------------------- |
| Anonymous MCP callers refused unless explicitly allowed                 | `@usegraft/mcp`, `graft serve`         |
| Approval decider derived from the verified caller, never from input     | `@usegraft/db`, every deciding surface |
| A requester can never decide their own approval                         | `decideApproval`                       |
| Per-route scopes on the Studio API and MCP tools                        | `@usegraft/studio`, `@usegraft/mcp`    |
| Path containment with symlink refusal on every filesystem sink          | `@usegraft/compiler`                   |
| Rate identity from the connection peer, not a client header             | `@usegraft/core`                       |
| Authored MDX refused unless the renderer opts into full MDX             | `@usegraft/mdx-safety`                 |
| Host validation and cross-origin refusal on the local Studio            | `graft serve`, `graft studio`          |
| Runtime credential has no `UPDATE` on `approvals`, enforced by Postgres | `graft harden`, container by default   |

The decisions behind these live in [`docs/adr/`](docs/adr/), each stating the
premise it depends on. If you are reporting something that shows a premise is
false, say which one — that is the most useful kind of report.

## Deploying safely

- Do not set `GRAFT_MCP_ALLOW_ANONYMOUS=1` on anything reachable from a network.
- Give agent tokens `content:write` at most. Never `approvals:decide`.
- Run `graft harden <role>` and serve under that role. The all-in-one container
  already does; `GRAFT_MODE=serve` needs `GRAFT_HARDEN=1` because that database
  is yours, not the container's.
- Set `trustedProxyHops` to the number of proxies you actually run. The default,
  `0`, ignores `x-forwarded-for` entirely, which is correct when nothing is in
  front of you.
- Leave `MdxBody` at `trust: "restricted"` unless every author has commit access.

## Supported versions

Pre-1.0: only the latest minor receives fixes.
