---
"@usegraft/contracts": minor
"@usegraft/core": minor
"@usegraft/db": minor
"@usegraft/cli": minor
---

Rate limits key on the real peer address, and concurrency can no longer outrun
them.

Every rate limit in the product was bypassable with a header.
`clientIp` read `x-forwarded-for.split(",")[0]` — the **leftmost** entry, which
under XFF's append semantics is whatever the original client wrote. Rotating the
header minted a fresh bucket per request, defeating per-function limits, the
handler-wide backstop, and the anti-brute-force property they exist for.

Separately the limiter counted prior audit rows, ran the handler, and recorded
its row afterwards — a window spanning the entire invocation. N concurrent
requests all read the same count, all saw room, and all ran.

**Breaking:**

- `AuditStore.record(entry)` is replaced by `reserve(entry) => id` and
  `settle(id, outcome)`. The row is inserted before the call is admitted, so the
  counter and the evidence are the same row. A row left `in_flight` is a crashed
  or still-running invocation, which is worth being able to see.
- `FunctionsHandlerOptions.trustedProxyHops` (default `0`) controls whether
  `x-forwarded-for` is read at all. At `0` it is ignored entirely. At `n`, the
  nth entry **from the right** is used — the address your own nearest proxy
  observed, which a client cannot forge past. Set it to the number of proxies
  you run.
- `runtimeRoleGrantsSql` grants `UPDATE (status, duration_ms) ON audit_log`.
  Column-scoped deliberately: the runtime may record how a call ended, never
  rewrite who made it or what it counted against.

`PEER_HEADER` (`x-graft-peer`) is exported from `@usegraft/contracts`. Graft's
Node adapter strips any inbound copy and sets it from the socket, so unlike
`x-forwarded-for` it cannot be written by a client.
