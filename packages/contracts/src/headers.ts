/**
 * Header names shared between Graft's HTTP adapters and the handlers they feed.
 *
 * They live here because both sides must agree on the exact string and neither
 * owns the other: the Node adapter ships in @usegraft/cli, the handler that
 * reads it in @usegraft/core.
 */

/**
 * The real socket peer address, set by a Graft adapter after stripping any
 * inbound copy.
 *
 * Rate limiting keys on this rather than `x-forwarded-for`, which is written by
 * the client. XFF is append-ordered, so its leftmost entry — the one the
 * previous implementation read — is whatever the original caller chose to put
 * there; rotating it minted a fresh rate bucket per request. Honour XFF only
 * when the deployment declares how many proxy hops it actually controls
 * (`trustedProxyHops`).
 */
export const PEER_HEADER = "x-graft-peer";
