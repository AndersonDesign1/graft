---
"@usegraft/mcp": patch
---

`explain_error` for `REMOTE_STORE_FAILED` no longer promises that a failed save did not happen. When GitHub refused, nothing was written, but a network error can arrive after GitHub applied the request, so agents are told to reload before retrying. A 404 now also names its other cause: a private repository the token or GitHub App cannot see.
