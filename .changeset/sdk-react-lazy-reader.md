---
"@usegraft/sdk-react": patch
---

`createGraft` with an `endpoint` builds its content API reader on the first
read instead of when the handle is made. A same-origin endpoint such as
`/api/content/v1` resolves against the page, and during server rendering there
is no page, so a server that imported the module calling `createGraft` threw
`CONFIG_INVALID` before rendering anything. Now the module loads anywhere and
only a read on the server fails.

**BREAKING:** two configurations that were silently wrong now throw
`CONFIG_INVALID`. A read with any `branch` through `graft.client`, even
`"main"`, such as
`graft.client.getDocument("docs", "intro", { branch: "preview" })`, returned
the endpoint's own branch. The helpers already refused it. And `endpoint`
passed with `index` ignored `index`. sdk-vue has carried both fixes since it
was added.
