# [HIGH] MCP HTTP endpoint allows unauthenticated callers by default, exposing content writes, asset uploads, and approval decisions

**File:** [`examples/landing-page/app/api/mcp/route.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/examples/landing-page/app/api/mcp/route.ts#L36-L42) (lines 36, 42)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** medium  •  **Slug:** `missing-auth`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

`requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"` (line 36) fails OPEN: unless the operator remembers to set the env var, `createGraftMcpHandler` resolves anonymous actors and serves them the full tool surface (packages/mcp/src/http.ts only rejects anonymous when requireActor is true). Unlike `graft serve`/`graft studio`, which emit runtime warnings when bound insecurely, this deployable-to-Vercel route (the sibling fn route reads VERCEL_GIT_COMMIT_SHA) has no runtime guardrail — only a code comment. On a deployed instance, an unauthenticated attacker over POST /api/mcp can invoke: (a) `write_content` — authors arbitrary MDX into the content tree and compiles it into the live Postgres index (content defacement, persistent DB writes); (b) `put_asset` — uploads arbitrary binaries to the project's S3 bucket; (c) `list_approvals` — discloses pending approvals including full input payloads; (d) `decide_approval` — approves/denies pending approvals. Because the default single-credential DATABASE_URL setup grants UPDATE on `approvals` unless the operator ran the optional role hardening, (d) completes a fully unauthenticated self-approval loop: request approval for the destructive `deleteSubmission` via POST /api/fn/deleteSubmission, approve it via MCP decide_approval, then consume it — anonymous destruction of operational data.

## Recommendation

Fail closed: invert the default so anonymous MCP callers are rejected unless explicitly opted out for localhost (e.g. requireActor defaults based on bind host, or GRAFT_MCP_REQUIRE_AUTH unset => reject remote). Add a startup warning when the MCP route is mounted without auth, mirroring serve.ts/studio.ts. Document and enforce the hardened runtime DB role (runtimeRoleGrantsSql) so decide_approval is DB-blocked regardless.

## Revalidation

**Verdict:** true-positive

Verified: examples/landing-page/app/api/mcp/route.ts wires `requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"` (flagged line 36/42 region) which fails open; http.ts then serves the anonymous actor every tool. Unlike graft serve/studio there is no warning or bind-host check anywhere on this path — only a code comment — and no Next.js middleware exists in the app to compensate, while the sibling routes confirm this app is built for Vercel deployment. The unauthenticated chain is fully constructible from verified code: (a) write_content authors arbitrary MDX and compiles it into the live Postgres index (defacement, persistent writes); (b) put_asset reads any process-readable file (e.g. .env) and returns a presigned GET URL to the caller (packages/assets/src/storage.ts); (c) list_approvals discloses pending function names and full input payloads; (d) decide_approval flips pending→approved with an attacker-chosen decidedBy (NULL requestedById rows pass via isNull). For gated functions like deleteSubmission the submissions:admin access rule blocks anonymous filing at the fn layer, but delete_content (public:true destructive) completes the anonymous request→approve→consume loop end-to-end. Same vulnerability class and mechanism as F4 but a different file/deployment — not a duplicate. HIGH stands.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
