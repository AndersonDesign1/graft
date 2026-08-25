# [HIGH] MCP HTTP endpoint allows unauthenticated callers by default, exposing content writes, asset uploads, and approval decisions

**File:** [`examples/docs-site/src/pages/api/mcp.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/docs-site/src/pages/api/mcp.ts#L34-L40) (lines 34, 40)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** medium  •  **Slug:** `missing-auth`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

`requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"` (line 34) fails OPEN: without that env var, createGraftMcpHandler serves the full tool surface to anonymous actors. This Astro example is intended for external deployment (its comments say 'do that for anything reachable from outside'), but there is no runtime enforcement or warning — unlike graft serve/graft studio, whose insecure-bind warnings are the actual control. An unauthenticated attacker can call write_content (arbitrary MDX written into the checkout and compiled into the live Postgres index — content defacement), put_asset (arbitrary binary upload to S3), list_approvals (disclosure of pending approval inputs), and decide_approval (approve/deny pending approvals). With the common single-credential DATABASE_URL that retains UPDATE on approvals, this yields a complete unauthenticated self-approval loop against destructive functions, ending in anonymous data deletion.

## Recommendation

Default requireActor to closed (reject anonymous) and require an explicit local-dev opt-out; add a runtime warning when the MCP mount lacks authentication; enforce the hardened runtime DB role so decideApproval cannot run under the serving credential.

## Revalidation

**Verdict:** true-positive

Verified: examples/docs-site/src/pages/api/mcp.ts line ~34 wires `requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"`, which fails open when the env var is unset, handing anonymous actors the entire tool surface through createGraftMcpHandler (http.ts only rejects anonymous when requireActor is true). There is no compensating control: sdk-astro's graftRoute is a pure Request pass-through with no auth, neither app ships middleware (none found), and no runtime warning mirrors serve.ts's insecure-bind notice despite the file's own comment saying to set the variable 'for anything reachable from outside'. Impact is concrete, not hypothetical: write_content performs unauthenticated MDX authoring compiled into the live Postgres index (defacement/persistent writes); delete_content is defineFunction'd `public: true, destructive: true`, so an anonymous caller files an approval (requestedById NULL), approves it via decide_approval (isNull(requestedById) satisfied by the default 'mcp-operator'), and consumes it — full unauthenticated content destruction; list_approvals leaks pending function inputs and requester ids. HIGH is justified: the endpoint is explicitly built for external agents, and the fail-open default converts a configuration omission into full compromise.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
