# [MEDIUM] Local Studio runs with authorize=undefined and no Origin/Host validation — any local process or drive-by webpage can decide approvals and rewrite content

**File:** [`packages/cli/src/commands/studio.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/cli/src/commands/studio.ts#L65-L90) (lines 65, 66, 74, 75, 80, 81, 90)
**Project:** graft
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-csrf-dns-rebinding`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

On loopback (the default) the authorize callback is left undefined (L74-81), and createStudioApiHandler treats that as unauthenticated access. The Studio surface includes highly privileged mutations reached with no credential: POST /api/studio/v1/approvals/:id/decide (approve/deny destructive operations), PUT /api/studio/v1/document (writes attacker-chosen frontmatter/body into MDX source files), /changes/commit (creates git commits), and /compilations/:id/revert (rewinds the content tree). There is no Origin/Sec-Fetch/Host check anywhere in the stack (createNodeListener imported from ./serve blindly trusts the Host header, and JSON bodies are parsed regardless of Content-Type), so (a) any co-resident process or compromised agent can silently self-approve its own pending destructive operations, and (b) a malicious webpage can issue no-cors cross-origin POSTs to http://127.0.0.1:4983/api/studio/v1/... whose side effects execute even though the response is opaque; DNS rebinding additionally yields read access to documents and pending approval inputs.

## Recommendation

Validate Host against the bind address and reject cross-origin requests (Origin/Sec-Fetch-Site), or always require a bearer token for mutating endpoints (mint a per-process token, print it, and have the SPA send it). Consider separating read and write authorization so approval decisions are never unauthenticated.

## Revalidation

**Verdict:** true-positive

Verified independently of F5 at studio.ts: loopback (the default host 127.0.0.1, port 4983) leaves authorize undefined (L74-81), which createStudioApiHandler treats as unauthenticated; the surface includes POST /api/studio/v1/approvals/:id/decide (decideApproval), PUT /api/studio/v1/document (writeDocument writes attacker-controlled frontmatter/body into MDX sources and recompiles), /changes/commit (git commit), and /compilations/:id/revert. createNodeListener is imported from ./serve and performs no Origin/Host/Sec-Fetch validation; JSON bodies parse regardless of Content-Type, so no-cors cross-site POSTs execute side effects, and DNS rebinding grants full read access including pending approval inputs. A co-resident malicious process (e.g., npm lifecycle script) needs no browser at all to hit 127.0.0.1:4983 and silently approve pending destructive ops or rewrite content. Same vulnerability class as F5 but a different command/mount/file, so per the rules it is not a duplicate — it stands on its own. MEDIUM with medium confidence matches the browser-dependent exploit prerequisites.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-09)
