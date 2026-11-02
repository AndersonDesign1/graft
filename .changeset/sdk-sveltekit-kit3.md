---
"@usegraft/sdk-sveltekit": patch
---

The README says how to import the client on SvelteKit 3, which removed `$lib`:
map `#lib/*` under `imports` in `package.json` and import
`#lib/server/graft.ts`. CI now builds and serves a real SvelteKit 2 app and a
real SvelteKit 3 app on the adapter, and `graftRoute` needed no change for
either.
