/**
 * Constants shared across packages that must agree on an exact value, where
 * neither side owns the other.
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

/**
 * Where a static-tier project's compiled index lives, relative to the project
 * root.
 *
 * Here rather than in @usegraft/db because the CLI resolves it while loading a
 * config and deliberately lazy-loads the database package — a static import
 * just to read one string would pull Postgres into every `graft` invocation.
 */
export const STATIC_INDEX_DEFAULT_PATH = ".graft/index.db";
