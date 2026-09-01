---
"@usegraft/content-api": minor
"@usegraft/cli": patch
---

Let the content API be read from a browser on another origin.

`@usegraft/sdk-react` reads over HTTP from a browser, and the handler sent no
CORS headers at all — so unless the app and the content API shared an origin,
every read was blocked by the browser. That is the ordinary deployment for the
browser client, which made it largely unusable as shipped. cubic raised it on
the pull request.

`createContentApiHandler` takes `allowedOrigins`: a list, or `"*"`. Omitted
means no CORS headers and same-origin only, which stays the default because
publishing an endpoint to other origins is the deployer's decision rather than
a library's. `graft serve` reads `GRAFT_CONTENT_ALLOWED_ORIGINS` (comma
separated, or `*`).

Details that are easy to get wrong and are tested:

- An allowed origin is echoed with `Vary: Origin`. Without `Vary`, a shared
  cache can hand one origin the response it stored for another and the
  allowlist stops meaning anything.
- A disallowed origin gets an ordinary response with no CORS header, not a
  refusal. The browser enforces it; answering differently would turn the
  allowlist into an origin oracle for non-browser callers, who are not bound by
  CORS in the first place.
- `OPTIONS` preflight is answered before method validation and before the rate
  limiter, so a browser asking permission is neither a `405` nor a charge
  against the budget for the read it precedes.
- Error responses carry the headers too, or the browser hides the body and a
  developer debugging a `400` sees an opaque network failure instead of the
  `fix` this API took care to send.
