---
"@usegraft/mcp": patch
---

`explain_error` for `REMOTE_STORE_FAILED` no longer promises that a failed save did not happen. A refusal means that one request was not applied, but a publish can move production before a later step is refused, and a network error can arrive after GitHub applied the request, so agents are told to check the branches before retrying. A 404 now also names its other cause: a private repository the token or GitHub App cannot see.
