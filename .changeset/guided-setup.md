---
"@usegraft/cli": minor
"@usegraft/compiler": minor
"@usegraft/mcp": minor
"create-graft": minor
---

A new site in one command, and a checklist that says what to do next.

- `npm create graft` (the new `create-graft` package) runs `graft create`: it
  asks what kind of site (blog, docs, shop, portfolio or blank), how people
  will edit it (online in Studio, or as files in git) and which database to
  use, then writes the site with a Next.js app, installs it, migrates, loads
  the example content and compiles. Every question has a flag, and `--yes`
  takes the defaults, so an agent can run it with no prompts.
- `--database new` makes a free Postgres with no account. It lasts 72 hours
  unless claimed: `graft db claim` prints the link, waits for the claim, and
  saves the new connection string to `.env`. Any Postgres 13 or newer works
  instead.
- `graft doctor` and the MCP tool `setup_status` check the database and its
  version, the schema, a database waiting to be claimed, content, the index
  and Studio sign-in, and end with the one thing to do next.
- A new site gets an `AGENTS.md`, and the docs serve a setup guide for agents
  at `/start.md`.
