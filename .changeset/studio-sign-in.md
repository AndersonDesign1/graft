---
"@usegraft/studio": minor
"@usegraft/cli": minor
---

A hosted Studio now has sign-in. Set `GRAFT_STUDIO_SECRET` and people sign in with GitHub (`GRAFT_GITHUB_CLIENT_ID` and `GRAFT_GITHUB_CLIENT_SECRET`) or with an invite link from `graft studio invite <email> --role editor`, into a signed, HTTP-only session cookie. `GRAFT_STUDIO_EDITORS` lists who may sign in with GitHub and with which role; without it, anyone with write access to the content repository can. An invite link signs its holder in with the role it was made with, whether or not they are on that list. Roles map to scopes: `viewer`, `contributor` (drafts, publishing opens a pull request), `editor` (adds the new `studio:publish` scope) and `admin` (adds `approvals:decide`). Bearer tokens keep working beside sessions.
