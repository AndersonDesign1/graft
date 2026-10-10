---
"@usegraft/cli": patch
---

`graft serve` passes every `Set-Cookie` header through. Its Node adapter copied response headers one value per name, so a response setting two cookies arrived with one, and a hosted Studio's sign-in lost the session cookie.
