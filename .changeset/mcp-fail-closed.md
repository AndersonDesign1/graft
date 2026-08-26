---
"@usegraft/mcp": minor
"@usegraft/cli": minor
---

MCP over HTTP fails closed. Authentication is no longer opt-in.

`createGraftMcpHandler` had `requireActor?: boolean` defaulting to **off**, on a
handler whose own docs advertise embedding it in "a Next.js route, a self-host
container, Vercel Fluid, or a Worker". Forgetting it published `write_content`,
`put_asset`, `delete_content` and `decide_approval` to anyone who found the URL —
and unlike `graft serve`, a library embedding got no warning at all.

**Breaking:**

- `requireActor` is replaced by `allowAnonymous`, which defaults to `false`.
- Constructing a handler with neither an `actor` resolver nor
  `allowAnonymous: true` now **throws** (`CONFIG_INVALID`). A deployer who
  forgets gets a startup failure with a fix line instead of an open endpoint.
- `graft serve` derives the default from the bind host: anonymous MCP is served
  on loopback (zero-config local dev) and refused anywhere else.
  `GRAFT_MCP_REQUIRE_AUTH` is retired — its secure value (`1`) is now the
  default, so deployments that set it are unaffected. Off loopback,
  `GRAFT_MCP_ALLOW_ANONYMOUS=1` is a deliberate, warned-about opt-in for
  operators fronting the server with their own auth proxy.
- The insecure-bind warning now tests what is _enforced_. It previously treated
  "a dev token exists" as sufficient, so setting `GRAFT_DEV_TOKEN` silenced the
  warning while anonymous callers kept reaching `decide_approval`.
