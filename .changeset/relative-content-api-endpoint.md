---
"@usegraft/content-api": minor
"@usegraft/sdk-react": patch
---

Let `endpoint` be a same-origin path, which is what the docs already tell you
to write.

`createGraft({ endpoint: "/api/content/v1" })` threw `TypeError: Invalid URL`
before a single read. `normalizeEndpoint` called bare `new URL(endpoint)` with
no base, and a relative path has no origin to parse against.

That form is not a stray idea — it is the example in
`/docs/reading-content` and in the `createGraft` JSDoc that ships inside
`@usegraft/sdk-react`. So the first thing a browser reader copied out of the
documentation crashed at construction. cubic raised it on the pull request.

A string endpoint now resolves against `location.href` when one exists. An
absolute endpoint is unchanged, and a `URL` instance is unchanged. Outside a
browser there is no origin to resolve against, and guessing one would send
content reads somewhere arbitrary, so a relative path there is refused as
`CONFIG_INVALID` with that reason rather than a bare `TypeError`.
