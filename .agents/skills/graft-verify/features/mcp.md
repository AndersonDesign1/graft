# MCP server

An agent connects over stdio, discovers the tools, reads and writes content,
and recovers from an error using its `fix`.

## Sub-features

- `mcp.tools`: `tools/list` returns the content, schema, function, branch,
  approval and error tools.
- `mcp.read`: `get_content`, `list_content`, `search_content`.
- `mcp.write`: in a local project, `write_content` validates, writes the
  file, and compiles. On a `graft serve` that writes to GitHub, it commits to
  the connection's draft branch instead and does not compile;
  `publish_drafts` publishes.
- `mcp.write-error`: a bad write returns `SCHEMA_VALIDATION_FAILED` with
  `fix`, `details.issues` and `howToRecover`, and writes nothing.
- `mcp.explain`: `explain_error` describes a code and how to recover.
- `mcp.gate`: by default, `delete_content` and destructive `run_function`
  calls return `DESTRUCTIVE_OP_REQUIRES_APPROVAL` with an approval id
  (Postgres). A client that supports elicitation can approve in-band
  instead, and the call completes.

## How to get to it (user POV)

- `.mcp.json` with `"command": "npx", "args": ["-y", "@usegraft/cli@latest", "mcp"]`
  in any MCP client.
- `graft serve` exposes the same tools at `POST /api/mcp`.

## Driving it with mcp-call.mjs

Preconditions: `REPO` and `O` from the skill's Launch step, a sandbox, `cd "$P"`, and
`M=$REPO/.agents/skills/graft-verify/scripts/mcp-call.mjs`.

- **Tools are listed.** `$O node $M tools/list` includes
  `get_content`, `write_content`, `delete_content`, `explain_error`.
- **Read.** `$O node $M get_content '{"collection":"pages","slug":"home"}'`
  prints the document with `"title": "Hello, Graft"`.
- **A bad write fails with a fix.**
  `$O node $M write_content '{"collection":"pages","slug":"about","data":{"title":42}}'`
  prints `"error": "SCHEMA_VALIDATION_FAILED"` and a `fix` naming `title`.
  `ls content/pages` shows no `about.mdx`.
- **The corrected write lands.**
  `$O node $M write_content '{"collection":"pages","slug":"about","data":{"title":"About"},"body":"Hi."}'`
  prints `"written": "pages/about.mdx"` and `"added": ["pages/about"]`.
  `cat content/pages/about.mdx` shows the frontmatter.
- **The gate holds** (Postgres sandbox).
  `$O node $M delete_content '{"collection":"pages","slug":"home"}'` returns
  `DESTRUCTIVE_OP_REQUIRES_APPROVAL` with an `approvalId` and a `fix` naming
  `graft approve <id>`. `ls content/pages` still shows `home.mdx`.

## Gotchas

- `write_content` takes `data` (frontmatter) and `body`, not `frontmatter`.
  A wrong argument name is a JSON-RPC `-32602` error, not a Graft error.
- `mcp-call.mjs` exits 1 when any call errored, which is expected when you
  drive a failing call on purpose.
- While any file in the tree is invalid, `write_content` and
  `delete_content` both fail with that file's `SCHEMA_VALIDATION_FAILED`,
  including a delete of the invalid file itself. The error comes from the
  compile that follows the write, so the write or delete may already be on
  disk: check the file before you retry. Fix or remove the invalid file
  first.
- Anonymous HTTP callers are refused unless the mount opts in. Stdio runs as
  the local operator.
