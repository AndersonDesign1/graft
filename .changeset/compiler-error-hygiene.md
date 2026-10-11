---
"@usegraft/compiler": patch
---

Two error-handling fixes. `GRAFT_REVALIDATE_URL` with a `user:password@` part is refused at startup without repeating the credentials, and a network error that quotes the webhook URL has its query stripped, so a token in the URL no longer reaches logs, agents or Studio toasts. Creating a GitHub draft branch now reads only GitHub's "already exists" answer as a race: any other 422, such as a missing commit, fails with `REMOTE_STORE_FAILED` and GitHub's reason, where it used to retry to exhaustion and report the document busy.
