/**
 * HTTP to a hosted Graft site with a bearer token: the Studio API for
 * `graft login`, `graft auth status` and `graft api`.
 *
 * Redirects are never followed, so the token only goes to the origin it was
 * saved for, and a site that cannot be reached is REMOTE_UNREACHABLE with a
 * fix instead of a bare fetch error.
 */
import { GraftError } from "@usegraft/contracts";

export interface SiteRequest {
  origin: string;
  token: string;
  /** A path on the site, starting with /api/. */
  path: string;
  method?: string;
  body?: string;
  /** Extra request headers by name; the token's header is always the saved one. */
  headers?: Record<string, string>;
}

export async function siteFetch(request: SiteRequest): Promise<Response> {
  const url = new URL(request.path, request.origin);
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${request.token}`);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (request.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  try {
    const init: RequestInit = { method: request.method ?? "GET", headers, redirect: "manual" };
    if (request.body !== undefined) init.body = request.body;
    return await fetch(url, init);
  } catch (error) {
    const reason =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    throw new GraftError({
      code: "REMOTE_UNREACHABLE",
      message: `Could not reach ${request.origin}: ${reason}`,
      fix: "Check the address with `graft auth status` and that the site is up. Log in again with `graft login <url>` if it moved.",
      details: { origin: request.origin },
    });
  }
}

export interface WhoAmI {
  /** Who the token acts as; null where the site has no sign-in (Studio on loopback). */
  user: string | null;
  scopes: string[];
  /** False when the site serves MCP but not Studio, so `graft api` has nothing to call. */
  studio: boolean;
}

function refused(origin: string, status: number): GraftError {
  return new GraftError({
    code: "TOKEN_INVALID",
    message: `${origin} refused the token (HTTP ${status}).`,
    fix: "Make a token in Studio under Developer, Agents, then run `graft login` again. A revoked token stops working at once.",
    details: { origin, status },
  });
}

/**
 * Check a token against the site: Studio's workspace says who it acts as.
 * Where the site serves no Studio, listing the MCP tools proves the token
 * instead.
 */
export async function whoAmI(origin: string, token: string): Promise<WhoAmI> {
  const response = await siteFetch({ origin, token, path: "/api/studio/v1/workspace" });
  if (response.status === 401 || response.status === 403) throw refused(origin, response.status);
  if (response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const user =
      typeof body === "object" && body !== null && "user" in body && typeof body.user === "object"
        ? body.user
        : null;
    const id = user !== null && "id" in user && typeof user.id === "string" ? user.id : null;
    const scopes =
      user !== null && "scopes" in user && Array.isArray(user.scopes)
        ? user.scopes.filter((scope): scope is string => typeof scope === "string")
        : [];
    return { user: id, scopes, studio: true };
  }
  if (response.status !== 404) {
    throw new GraftError({
      code: "REMOTE_UNREACHABLE",
      message: `${origin} answered HTTP ${response.status} to Studio's workspace route.`,
      fix: "Check that the address is a Graft site run by graft serve, then try again.",
      details: { origin, status: response.status },
    });
  }
  const { connectRemote } = await import("@usegraft/mcp");
  const tools = await connectRemote({ origin, token });
  try {
    await tools.tools();
  } finally {
    await tools.close();
  }
  return { user: null, scopes: [], studio: false };
}
