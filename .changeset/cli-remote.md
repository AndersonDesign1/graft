---
"@usegraft/cli": minor
"@usegraft/mcp": minor
"@usegraft/contracts": minor
---

Work with a hosted site from the terminal. `graft login <url>` checks a token
made in Studio under Developer, Agents, and saves it in
`~/.config/graft/hosts.json` (mode 600). The token comes from stdin
(`--with-token`) or a prompt that does not echo, never from an argument.

```sh
printf %s "$TOKEN" | graft login https://cms.example.com --with-token
graft content list --remote
graft api entries -f collection=posts --paginate
```

- `--remote` on `graft content`, `graft drafts`, `graft schema`, `graft fn`,
  `graft mcp tools`, `graft mcp call` and `graft approvals` runs the same MCP
  tools on the site's `/api/mcp`. `GRAFT_URL` and `GRAFT_TOKEN` in the
  environment do the same without the flag, and `--local` overrides them.
  Neither is read from `.env`.
- `graft api <path>` calls any Studio API route with the saved token: `-X`,
  `-f`/`-F` fields, `-H`, `--input`, `--include` and `--paginate`. It reaches
  only the logged-in site, follows no redirects, and needs `--yes` for
  `-X DELETE`.
- `graft auth status` checks each saved token against its site,
  `graft auth token` prints one for piping, and `graft logout` forgets one.
- A refused token exits 4 with `TOKEN_INVALID`; an unreachable site is the new
  `REMOTE_UNREACHABLE`. No token can approve an action, so a remote delete
  still exits 3 until a person approves it.

`@usegraft/mcp` adds `connectRemote({ origin, token })`, a `ToolClient` over
HTTP to a hosted `/api/mcp`.
