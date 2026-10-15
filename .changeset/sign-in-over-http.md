---
"@usegraft/studio": patch
"@usegraft/compiler": patch
"@usegraft/cli": patch
---

Studio no longer loops silently when opened over plain http on an address other than localhost. The session cookie is `Secure` there, so the browser dropped it and sign-in landed back on the form with no message. Studio now says sign-in needs https, or localhost, instead of showing a form that can't work, and an invite link stays unused until it can sign someone in.

`graft doctor` and `setup_status` no longer make a missing `GRAFT_STUDIO_SECRET` the next step: it only matters once the site is online. That check now has its own id, `studio-secret`. With nothing else to do, doctor says the project is ready to work on and that the `!` lines are for going online. Once the secret is set, creating the owner account is still the next step.

`graft --help` lists `graft studio setup-code` and `graft studio invite`.
