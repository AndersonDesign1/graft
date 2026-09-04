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
- **A stolen runtime credential can rewrite and hide content.** The hardened
  role holds `INSERT`/`UPDATE` on `content_index` because projection needs it,
  so raw SQL under that credential can change any document or set `deleted`.
  The human gate on MCP `delete_content` is an application control against an
  agent misusing the tool. It is not a database control against a stolen
  credential, and no grant list short of refusing content writes entirely would
  make it one.

  **The approval gate is the exception, deliberately.** It holds even against a
  stolen runtime credential: no `UPDATE` on `approvals`, and a column-scoped
  `INSERT` that cannot name `status` or `decided_by`. Both halves are needed.
  Withholding `UPDATE` alone leaves the credential able to file a row that is
  already approved, which is cheaper than flipping a pending one.

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
| Executable MDX refused at compile, across the whole content tree        | `graft compile`, `mdxTrust`            |
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
  `mdxTrust` in graft.config.ts is the compile-side half of the same decision, and
  the two have to agree.

## Supported versions

Pre-1.0: only the latest minor receives fixes.

## Remaining GitHub Security alerts

Most leftover Dependabot rows are transitive pins. This repository now
overrides `browserslist` to 4.28.8, `path-to-regexp@6.1.0` to 6.3.0,
`launch-editor` to 2.14.1, and the old `esbuild` pins to `0.28.2`.

**Left for an operator to dismiss**

- **zizmor `artipacked` on `.github/workflows/release.yml`**. The changesets
  job must keep checkout credentials so it can push `changeset-release/<branch>`.
  `persist-credentials: false` would break the release. The finding is ignored
  in-file (`zizmor: ignore[artipacked]`) and must be dismissed on the Security
  tab; this token cannot do that.
- **vite 5.4.21** (vitest 3's runner), if Dependabot still flags it after the
  override pass. 5.4.21 is the last 5.4 patch. Moving vitest across a major
  to pick up Vite 6+ is a separate change. The alert is the test runner's
  dev server, not `graft serve`.
