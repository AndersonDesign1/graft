---
"@usegraft/compiler": patch
"@usegraft/studio": patch
"@usegraft/cli": patch
---

One loopback list decides every "https unless loopback" question: `@usegraft/compiler` exports `LOOPBACK_HOSTS` and `isLoopbackHost`, and the revalidate webhook, Studio's `Secure` session cookie and `graft studio invite` all use them, so the invite check and the cookie can never disagree about a host. Paths under a regular file now read as absent instead of failing with `ENOTDIR`, and deleting a document that is already gone succeeds.
