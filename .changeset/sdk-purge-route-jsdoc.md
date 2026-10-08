---
"@usegraft/sdk-astro": patch
"@usegraft/sdk-sveltekit": patch
"@usegraft/sdk-tanstack-start": patch
"@usegraft/sdk-react-router": patch
---

Fix the caching note in each adapter's JSDoc. It said to purge
`tagsForChanges(branch, changeSet)` "from your compile webhook", but Graft sends
no webhook. It now says to purge from your own route, called with a compile's
change list, for example the output of `graft compile --json`.
