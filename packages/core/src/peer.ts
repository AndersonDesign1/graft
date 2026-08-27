/**
 * The address a request actually arrived from.
 *
 * Deliberately NOT a header. The first attempt at this used `x-graft-peer`,
 * set by Graft's Node adapter after stripping any inbound copy — which is
 * sound for `graft serve` and worthless everywhere else, because a Next.js or
 * Astro route hands the handler the browser's Request untouched. A client could
 * then send `x-graft-peer: <anything>` and pick its own rate-limit bucket:
 * exactly the `x-forwarded-for` bug, relocated to a header nobody knew they had
 * to strip.
 *
 * A WeakMap keyed by the Request object cannot be forged over the wire. Only
 * code holding the object can write to it, which means the adapter that built
 * it. Requests that no adapter registered simply have no peer, and the caller
 * decides what that means.
 */
const peers = new WeakMap<Request, string>();

/**
 * Record the socket address a request came from. Called by an adapter that owns
 * the connection — never from anything that merely receives a Request.
 */
export function setRequestPeer(request: Request, address: string): void {
  peers.set(request, address);
}

/** The recorded peer address, or undefined when no adapter registered one. */
export function getRequestPeer(request: Request): string | undefined {
  return peers.get(request);
}
