---
"@usegraft/db": minor
"@usegraft/compiler": minor
"@usegraft/studio": minor
"@usegraft/cli": minor
"@usegraft/auth": minor
---

Studio gets a media library, agent tokens, and the site's settings with deploy
hooks.

- **Media.** A Media page lists the files in the asset store that Studio
  uploaded or an entry uses. Upload, search, write alt text, see which entries
  use a file, and delete one nothing uses. Image fields have Choose…, and a gallery's Add image, which pick from the same library and take the file's alt text when the field has none. New routes under `/api/studio/v1/assets`.
- **Agents.** Admins make a token per agent under Developer, Agents, with
  Read, Write drafts or Publish access. The token is shown once and only its
  hash is stored. `graft serve` accepts it on `/api/mcp`, the Studio API and
  functions, and revoking it takes effect on the next request. No token can
  decide approvals. `@usegraft/auth`'s resolver gains a `tokens` option for
  this.
- **Site and deploy hooks.** Settings has the site's name and address, and
  deploy hooks: URLs called with a `POST` after every publish of
  database-sourced content, with an optional bearer secret. Each hook shows
  what it answered last, and Send a test calls it now. A failing hook never
  undoes a publish. `@usegraft/compiler` exports `fireDeployHooks`.
- New scope `studio:settings`, held by admins.
- A Studio route that needs a table the database doesn't have answers
  `MIGRATION_REQUIRED` (503) with the fix, instead of failing the request.

Run `graft db migrate` (migration 0013 adds `assets`, `agent_tokens`,
`site_settings` and `deploy_hooks`). Run `graft harden <role>` again if you
use a runtime role.
