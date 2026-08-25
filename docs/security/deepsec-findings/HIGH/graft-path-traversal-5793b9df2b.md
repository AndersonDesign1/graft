# [HIGH] put_asset reads any file on the server via unrestricted `path` and exposes its contents at a retrievable URL

**File:** [`packages/mcp/src/server.ts`](https://github.com/AndersonDesign1/graft/blob/feat/core/blob/feat/packages/mcp/src/server.ts#L740-L833) (lines 740, 777, 785, 786, 830, 833)
**Project:** graft
**Severity:** HIGH  •  **Confidence:** high  •  **Slug:** `path-traversal`

## Owners

**Suggested assignee:** `josanderson25@gmail.com` _(via last-committer)_

## Finding

The put_asset tool accepts a `path` argument and passes it directly to readFileSync(path) with no validation, containment within contentDir, or allowlist — despite the tool description claiming it is for 'a file on the machine running this MCP server (local/stdio agents)'. The read bytes are uploaded to the S3-compatible asset store under an attacker-chosen key and the tool response includes `url: await storage.url(key)`, which per packages/assets/src/storage.ts is either a stable public URL (when publicBaseUrl is set) or a presigned GET URL (default 900s expiry) — i.e., directly fetchable by the calling agent. Attack scenario: a remote agent connected to the HTTP MCP surface (mounted at /api/mcp by graft serve, anonymous by default since requireActor is opt-in) calls put_asset { path: "/srv/app/.env", key: "assets/x.png" } and receives a presigned URL to the project's .env — leaking DATABASE_URL, GRAFT_DEV_TOKEN, NEON_API_KEY, and any other secrets — then reads it. Any file readable by the MCP process (SSH keys, source code, credentials of sibling services) is exfiltratable the same way. Even on loopback stdio servers, a prompt-injected agent can use this to stage arbitrary host files into the asset bucket. The key used for storage is validated (ASSET_KEY_RE, `..` unrepresentable), so the flaw is purely the unrestricted read source, not the destination.

## Recommendation

Restrict `path` to the project tree: resolve it and require the result to be inside contentDir (or another configured allowlist root), rejecting symlinks that escape it. Better: remove the `path` option entirely from servers created via createGraftMcpHandler (remote surfaces) and keep it only behind an explicit local-only flag for `graft mcp` stdio.

## Revalidation

**Verdict:** true-positive

Confirmed in source. put_asset passes the raw `path` argument to node:fs readFileSync(path) (server.ts line 785) with no resolution, containment within contentDir, symlink check, or allowlist — the tool description's 'local/stdio agents' caveat is documentation, not enforcement, and the exact same server object is served remotely by createGraftMcpHandler. The read bytes are stored under an attacker-chosen key validated only against ASSET_KEY_RE (which makes `..` unrepresentable in the destination, confirming the flaw is exclusively the read source), and the tool response includes `url: await storage.url(key)` (line 839). Per packages/assets/src/storage.ts, url() returns either a stable publicBaseUrl URL or a presigned GET signed with the server's credentials (default X-Amz-Expires=900), i.e., directly fetchable by the calling agent. Concrete attack on any HTTP-mounted surface (examples default to anonymous since requireActor is unset): tools/call put_asset {path: '/proc/self/environ' or '<repo>/.env', key: 'assets/x.png'} → fetch the returned presigned URL → exfiltrate DATABASE_URL, GRAFT_DEV_TOKEN, S3 keys, and any process-readable file. Even where the operator never intended remote exposure, a prompt-injected agent on a stdio server can stage host files into the bucket. High confidence and high severity.

## Recent committers (`git log`)

- AndersonDesign1 <josanderson25@gmail.com> (2026-08-10)
