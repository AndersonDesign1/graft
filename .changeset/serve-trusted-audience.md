---
"@usegraft/cli": minor
---

`graft serve` can check the token audience and record trusted callers as people.

`GRAFT_TRUSTED_ISSUERS` built each issuer with only its URL. The token audience
was never checked, so a token the provider minted for another of your apps was
accepted, and every caller was recorded in the audit log as an agent.

Two variables now apply to every listed issuer:

- `GRAFT_TRUSTED_AUDIENCE`: the accepted `aud` values, comma-separated. When
  issuers are set without it, `graft serve` prints a warning at startup.
- `GRAFT_TRUSTED_ACTOR_KIND`: `agent` (the default) or `human`. Any other value
  stops the server from starting with `INPUT_VALIDATION_FAILED`, before it opens
  a database connection.
