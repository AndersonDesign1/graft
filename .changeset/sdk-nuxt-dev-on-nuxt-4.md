---
"@usegraft/sdk-nuxt": patch
---

`nuxt dev` works on Nuxt 4 with the module installed. The module set Nitro 3's
`noExternals` list on every Nuxt, and Nitro 2 reads any `noExternals` value as
"bundle everything". On Nuxt 4.6.3 the dev server then failed with
`Cannot resolve "tiny-open"`, an optional import in Nuxt's own error overlay.
Production builds were not affected.
