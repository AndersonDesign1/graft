---
"@usegraft/cli": patch
---

`graft studio invite` refuses a plain `http://` address unless it is `localhost`, `127.0.0.1` or `[::1]`. The link carries a sign-in token, so plain http sent it unencrypted, and the session cookie is `Secure` off loopback, so the sign-in failed anyway. The usage message for a missing email now lists `--name` and `--days` too.
