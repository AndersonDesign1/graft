# [MEDIUM] Authentication on the remotely-deployable MCP HTTP handler is opt-in (requireActor defaults off)

**File:** [`packages/mcp/src/http.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/mcp/src/http.ts#L30-L70) (lines 30, 34, 55, 58, 62, 70)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `missing-auth`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

createGraftMcpHandler is explicitly designed to be embedded in internet-facing deployments ('a Next.js route, a self-host container, Vercel Fluid, or a Worker'), yet both `actor` and `requireActor` are optional and requireActor defaults to off. When omitted, every tool on the endpoint executes as anonymous: write_content performs authenticated-equivalent mutations (writes attacker-controlled MDX into the content tree and compiles it into the database — content injection/site defacement and disk-fill), delete_content files/consumes destructive-op approvals, put_asset exposes the arbitrary-file-read primitive found in server.ts, and list_approvals discloses pending approval contents (function names, full inputs, requester ids, correlation ids) to anyone. The insecure-bind warning that mitigates `graft serve`/`graft studio` (console.warn when binding beyond loopback without identity) does not exist for library embeddings — a deployer who copies the handler into a Next.js route gets no signal that auth must be switched on. The code that does exist is correct (TOKEN_INVALID is a hard 401, never downgraded to anonymous; requireActor without a resolver fails closed), so this is an insecure-default exposure rather than a broken check.

## Recommendation

Make authentication mandatory unless the server is explicitly created in a local-dev mode (e.g. require an explicit `allowAnonymous: true` / loopback-only assertion to construct the handler without a resolver), or emit the same class of startup warning serve.ts prints. At minimum, refuse write-capable tools (write_content, put_asset, delete_content, run_function mutations) for kind === "anonymous" regardless of requireActor.

## Revalidation

**Verdict:** true-positive

Verified in http.ts: both `actor` and `requireActor` are optional interface fields, requireActor defaults to undefined/off, and when off an anonymous-resolved request falls through to the full tool surface (the `requireActor && actor.kind === 'anonymous'` check simply never fires). The handler's own header comment advertises embedding in internet-facing targets ('a Next.js route, a self-host container, Vercel Fluid, or a Worker'), yet unlike serve.ts/studio.ts — whose insecure-bind console.warn the project itself defines as the control — a library embedding gets no startup signal whatsoever. The mechanics that DO exist are correct (resolver throw → hard 401 with no downgrade; requireActor without a resolver fails closed), so this is an insecure-default exposure rather than a broken check, exactly as the finding frames it. Exploitation requires an operator to embed the handler somewhere reachable while leaving defaults — but that is the documented, copy-paste path, and the exposed surface includes put_asset's arbitrary-file-read and the decide_approval self-approval primitive. Medium severity is well-calibrated: real and exploitable in realistic deployments, but contingent on deployment choices the code invites rather than performs.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
