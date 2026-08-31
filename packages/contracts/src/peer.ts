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

/**
 * The rate-limit identity for a caller with no verified actor.
 *
 * Lives here rather than beside one handler because more than one surface
 * needs it — `createFunctionsHandler` for anonymous function calls, and
 * `createContentApiHandler` for a read endpoint that never authenticates at
 * all — and the rule it encodes is the kind that must not be reimplemented
 * twice. `.greptile/rules.md` names it as a security invariant precisely
 * because the obvious reading of `x-forwarded-for` is the wrong one.
 *
 * Never reads the header unless the deployment declares how many proxies it
 * controls, and then counts from the RIGHT: entries are appended, so the
 * rightmost were added by infrastructure closest to us. A client can prepend
 * anything it likes and never reach that far.
 */
export function rateIdentity(request: Request, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const trusted = hops[hops.length - trustedProxyHops];
      if (trusted) return trusted;
    }
  }
  // No header fallback. A peer is something an adapter registers in-process;
  // anything arriving over the wire is the caller's word for it. "unknown"
  // shares one bucket across every unidentified caller, which is strict rather
  // than permissive — a deployment that wants per-caller limits declares its
  // proxy depth instead.
  return getRequestPeer(request) ?? "unknown";
}
