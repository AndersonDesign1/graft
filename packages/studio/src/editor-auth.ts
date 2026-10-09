/**
 * Sign-in for a hosted Studio: GitHub, or an invite link, into a signed
 * session cookie.
 *
 * These routes are the only ones a signed-out browser may reach, so they sit
 * in front of the API's scope table rather than in it. Everything else still
 * goes through that table: a session is just another way to arrive at a
 * principal with scopes.
 */
import { withoutTrailingSlashes } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import type { StudioPrincipal } from "./api";
import {
  OAUTH_COOKIE,
  ROLE_SCOPES,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  cookieHeader,
  randomState,
  readCookie,
  roleForRepoPermission,
  sign,
  verify,
  type EditorIdentity,
  type InviteData,
  type StudioRole,
} from "./session";

export interface GitHubSignInOptions {
  clientId: string;
  clientSecret: string;
  /** Default https://github.com. */
  webUrl?: string;
  /** Default https://api.github.com. */
  apiUrl?: string;
  fetch?: typeof fetch;
}

export interface EditorAuthOptions {
  secret: string;
  /** Where the UI is mounted ("" or "/studio"); sign-in lands there. */
  uiBasePath: string;
  /**
   * The public origin people reach Studio on (GRAFT_STUDIO_URL). Needed for
   * the OAuth callback behind a proxy that terminates TLS, where the request
   * URL says http.
   */
  publicUrl?: string;
  /** Who may sign in with GitHub, and as what. Empty: decided by `permissionOf`. */
  editors?: ReadonlyMap<string, StudioRole>;
  github?: GitHubSignInOptions;
  /** A login's permission on the content repository, from the store's credentials. */
  permissionOf?: (login: string) => Promise<string>;
}

export interface EditorAuth {
  /** Answers an /auth route, or null for anything else. */
  handle(request: Request): Promise<Response | null>;
  /** The principal a session cookie carries, or null. */
  authenticate(request: Request): StudioPrincipal | null;
}

const AUTH = "/api/studio/v1/auth";

export function principalFor(identity: EditorIdentity): StudioPrincipal {
  return {
    kind: "human",
    id: identity.id,
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.email ? { email: identity.email } : {}),
    scopes: ROLE_SCOPES[identity.role],
  };
}

export function createEditorAuth(options: EditorAuthOptions): EditorAuth {
  const ui = `${options.uiBasePath.replace(/\/$/, "")}/`;
  const editors = options.editors ?? new Map<string, StudioRole>();

  function session(request: Request): EditorIdentity | null {
    return verify<EditorIdentity>(options.secret, "session", readCookie(request, SESSION_COOKIE));
  }

  function origin(request: Request): string {
    return withoutTrailingSlashes(options.publicUrl ?? new URL(request.url).origin);
  }

  function redirect(location: string, cookies: string[] = []): Response {
    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const cookie of cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  }

  function signedIn(request: Request, identity: EditorIdentity, to: string): Response {
    return redirect(to, [
      cookieHeader(
        request,
        SESSION_COOKIE,
        sign(options.secret, "session", identity, SESSION_TTL_MS),
        SESSION_TTL_MS,
      ),
      cookieHeader(request, OAUTH_COOKIE, "", 0),
    ]);
  }

  /** Back to the UI with a reason it can put into words. */
  function failed(request: Request, reason: string): Response {
    return redirect(`${ui}?signin=${encodeURIComponent(reason)}`, [
      cookieHeader(request, OAUTH_COOKIE, "", 0),
    ]);
  }

  /** Only a path on this origin, so the parameter cannot become an open redirect. */
  function safeReturn(raw: string | null): string {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return ui;
    return raw;
  }

  async function githubCallback(request: Request, url: URL): Promise<Response> {
    const github = options.github;
    if (!github) return failed(request, "github_off");
    const pending = verify<{ state: string; return: string }>(
      options.secret,
      "oauth",
      readCookie(request, OAUTH_COOKIE),
    );
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!pending || !state || pending.state !== state || !code) {
      return failed(request, "expired");
    }

    const doFetch = github.fetch ?? fetch;
    const webUrl = withoutTrailingSlashes(github.webUrl ?? "https://github.com");
    const apiUrl = withoutTrailingSlashes(github.apiUrl ?? "https://api.github.com");

    const exchange = await doFetch(`${webUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: github.clientId,
        client_secret: github.clientSecret,
        code,
        redirect_uri: `${origin(request)}${AUTH}/github/callback`,
      }),
    });
    const token = ((await exchange.json().catch(() => ({}))) as { access_token?: string })
      .access_token;
    if (!exchange.ok || !token) return failed(request, "github_refused");

    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "graft-studio",
    };
    const user = (await (await doFetch(`${apiUrl}/user`, { headers })).json()) as {
      login?: string;
      name?: string | null;
      email?: string | null;
    };
    if (!user.login) return failed(request, "github_refused");
    let email = user.email ?? undefined;
    if (!email) {
      const emails = (await (
        await doFetch(`${apiUrl}/user/emails`, { headers })
      )
        .json()
        .catch(() => [])) as { email: string; primary: boolean; verified: boolean }[];
      email = Array.isArray(emails)
        ? emails.find((entry) => entry.primary && entry.verified)?.email
        : undefined;
    }

    const role = await roleFor(user.login, email);
    if (!role) return failed(request, "not_allowed");
    return signedIn(
      request,
      {
        id: user.login,
        ...(user.name ? { name: user.name } : {}),
        ...(email ? { email } : {}),
        role,
        via: "github",
      },
      safeReturn(pending.return),
    );
  }

  /**
   * The list decides when there is one; otherwise write access to the
   * repository does, checked with the store's own credentials. With neither,
   * nobody signs in with GitHub: an open door is never the default.
   */
  async function roleFor(login: string, email: string | undefined): Promise<StudioRole | null> {
    if (editors.size > 0) {
      return (
        editors.get(login.toLowerCase()) ??
        (email ? editors.get(email.toLowerCase()) : undefined) ??
        null
      );
    }
    if (!options.permissionOf) return null;
    return roleForRepoPermission(await options.permissionOf(login));
  }

  return {
    authenticate(request) {
      const identity = session(request);
      return identity ? principalFor(identity) : null;
    },

    async handle(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(`${AUTH}/`)) return null;
      const route = `${request.method} ${url.pathname.slice(AUTH.length)}`;

      switch (route) {
        case "GET /session": {
          const identity = session(request);
          return Response.json(
            {
              user: identity
                ? {
                    id: identity.id,
                    name: identity.name ?? null,
                    email: identity.email ?? null,
                    role: identity.role,
                    via: identity.via,
                    scopes: ROLE_SCOPES[identity.role],
                  }
                : null,
              methods: { github: Boolean(options.github), invite: true },
            },
            { headers: { "cache-control": "no-store" } },
          );
        }

        case "GET /github": {
          if (!options.github) return failed(request, "github_off");
          const state = randomState();
          const pending = sign(
            options.secret,
            "oauth",
            { state, return: safeReturn(url.searchParams.get("return")) },
            10 * 60_000,
          );
          const authorize = new URL(
            `${withoutTrailingSlashes(options.github.webUrl ?? "https://github.com")}/login/oauth/authorize`,
          );
          authorize.searchParams.set("client_id", options.github.clientId);
          authorize.searchParams.set("redirect_uri", `${origin(request)}${AUTH}/github/callback`);
          authorize.searchParams.set("scope", "read:user user:email");
          authorize.searchParams.set("state", state);
          authorize.searchParams.set("allow_signup", "false");
          return redirect(authorize.toString(), [
            cookieHeader(request, OAUTH_COOKIE, pending, 10 * 60_000),
          ]);
        }

        case "GET /github/callback":
          try {
            return await githubCallback(request, url);
          } catch {
            return failed(request, "github_refused");
          }

        case "GET /link": {
          const invite = verify<InviteData>(
            options.secret,
            "invite",
            url.searchParams.get("token"),
          );
          if (!invite) return failed(request, "link_expired");
          return signedIn(
            request,
            {
              id: invite.email,
              email: invite.email,
              ...(invite.name ? { name: invite.name } : {}),
              role: invite.role,
              via: "invite",
            },
            ui,
          );
        }

        case "POST /sign-out": {
          // Same-origin only, like every other state change.
          const from = request.headers.get("origin");
          if (from !== null && hostOf(from) !== url.host) {
            return Response.json(
              new GraftError({
                code: "UNAUTHORIZED",
                message: `Refusing sign-out from origin "${from}".`,
                fix: "Sign out from Studio itself.",
              }).toJSON(),
              { status: 401 },
            );
          }
          const headers = new Headers({ "cache-control": "no-store" });
          headers.append("set-cookie", cookieHeader(request, SESSION_COOKIE, "", 0));
          return new Response(null, { status: 204, headers });
        }

        default:
          return null;
      }
    },
  };
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}
