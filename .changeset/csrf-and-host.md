---
"@usegraft/studio": minor
"@usegraft/cli": minor
---

Host validation and CSRF protection for the local Studio.

A loopback Studio has no authentication by design, so anything that can reach
`127.0.0.1` can act. Browsers let a page do exactly that: every Studio mutation
is a plain POST/PUT parsed with `request.json()`, which ignores Content-Type —
so a cross-origin "simple request" carrying `text/plain` executed with no CORS
preflight. The attacker cannot read the response, but the side effect already
happened: an approval decided, a document overwritten, a commit made.

**Breaking:**

- `createNodeListener(handler, { allowedHosts })` refuses a request whose `Host`
  is not one it answers to, with 400. `graft serve` and `graft studio` derive
  the list from their bind address. Without this an attacker-chosen Host flowed
  into every handler, and a browser resolving any name to `127.0.0.1` is exactly
  how DNS rebinding reaches a loopback bind.
- The Studio API refuses state-changing requests whose `Origin` is cross-origin,
  and requires `Content-Type: application/json` on them — which forces a
  preflight for anything that omits Origin. Reads are unaffected.

The shell redirect is now `Cache-Control: no-store`: it is built from the
request's own Host and fires before any authorization runs, so a 302 cached by
path alone would outlive the Host check.

The Vite dev proxy rewrites `Origin` to the API's origin, since in development
the browser's origin is the Vite server rather than the Studio.
