/**
 * Sign-in for a hosted Studio: a Studio account (email and password), GitHub,
 * an OpenID Connect provider, or an invite link made on the command line.
 *
 * An account's session is a random token whose hash is a row in Postgres, so
 * signing out, removing someone or changing their role takes effect on their
 * next request. An OIDC sign-in for someone with an account gets that same
 * session. GitHub, command-line links and OIDC sign-ins admitted by
 * GRAFT_STUDIO_EDITORS still sign a stateless cookie.
 *
 * These routes are the only ones a signed-out browser may reach, so they sit
 * in front of the API's scope table rather than in it. Everything else still
 * goes through that table: a session is just another way to arrive at a
 * principal with scopes.
 */
import { withoutTrailingSlashes } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import {
  acceptInvite,
  acceptInviteForEmail,
  accountForSignIn,
  countAccounts,
  createOwner,
  createSession,
  deleteSession,
  hasActiveAccount,
  readInvite,
  recordSignIn,
  sessionAccount,
  setPassword,
  type Database,
  type StudioAccount,
} from "@usegraft/db";
import {
  assertPassword,
  decoyHash,
  hashPassword,
  hashToken,
  isAccountToken,
  newToken,
  normaliseEmail,
  setupCodeMatches,
  verifyPassword,
} from "./accounts";
import { finishOidcSignIn, startOidcSignIn, type OidcPerson, type OidcSignInOptions } from "./oidc";
import { assertSameOrigin, errorResponse, statusFor, type StudioPrincipal } from "./api";
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
  /**
   * An OpenID Connect provider. Someone it signs in is admitted by their
   * verified email: their Studio account's role, else GRAFT_STUDIO_EDITORS.
   */
  oidc?: OidcSignInOptions;
  /** A login's permission on the content repository, from the store's credentials. */
  permissionOf?: (login: string) => Promise<string>;
  /**
   * Studio accounts in this database: people sign in with an email and
   * password, the first visit creates the owner, and admins invite the rest
   * from Settings.
   */
  accounts?: {
    db: Database;
    /**
     * Let the first visit create the owner without the setup code. Only for a
     * Studio bound to this computer, where whoever can reach it already can
     * run commands here.
     */
    setupWithoutCode?: boolean;
  };
}

/** What the OAuth state cookie holds between leaving for a provider and coming back. */
interface PendingSignIn {
  state: string;
  return: string;
  verifier?: string;
  nonce?: string;
}

export interface EditorAuth {
  /** Answers an /auth route, or null for anything else. */
  handle(request: Request): Promise<Response | null>;
  /** The principal a session cookie carries, or null. */
  authenticate(request: Request): Promise<StudioPrincipal | null>;
}

/** The stored password of an account made by single sign-on: it matches nothing. */
const NO_PASSWORD = "none";

/** Wrong passwords in a row before an account is locked, and for how long. */
const SIGN_IN_LIMITS = { maxFailures: 5, lockMs: 15 * 60_000 } as const;

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

  const accounts = options.accounts;

  /** Who the session cookie says this is: an account's row, or a signed cookie. */
  async function session(request: Request): Promise<EditorIdentity | null> {
    const raw = readCookie(request, SESSION_COOKIE);
    if (isAccountToken(raw)) {
      const found = accounts ? await sessionAccount(accounts.db, hashToken(raw)) : null;
      return found ? accountIdentity(found) : null;
    }
    return verify<EditorIdentity>(options.secret, "session", raw);
  }

  /** A new session row for an account, as the cookie that carries it. */
  async function accountSession(request: Request, account: StudioAccount): Promise<string> {
    if (!accounts) throw accountsOff();
    const { token, hash } = newToken();
    await createSession(accounts.db, {
      tokenHash: hash,
      userId: account.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    return cookieHeader(request, SESSION_COOKIE, token, SESSION_TTL_MS);
  }

  /** A new session for an account, answered as JSON with its cookie. */
  async function accountSignedIn(request: Request, account: StudioAccount): Promise<Response> {
    const headers = new Headers({ "cache-control": "no-store" });
    headers.append("set-cookie", await accountSession(request, account));
    return Response.json({ user: userJson(accountIdentity(account)) }, { headers });
  }

  /** Run an account route: same-origin JSON in, a GraftError out as JSON. */
  async function accountRoute(
    request: Request,
    url: URL,
    run: (db: Database, input: Record<string, unknown>) => Promise<Response>,
  ): Promise<Response> {
    try {
      if (!accounts) throw accountsOff();
      assertSameOrigin(request, url);
      const parsed: unknown = await request.json().catch(() => null);
      const input =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      return await run(accounts.db, input);
    } catch (error) {
      if (error instanceof GraftError) return errorResponse(error, statusFor(error));
      throw error;
    }
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

  /**
   * Back to the UI with a reason it can put into words, at the page the person
   * started from (its branch and hash kept) when the attempt got that far.
   */
  function failed(request: Request, reason: string, returnTo?: string): Response {
    const target = safeReturn(returnTo ?? null);
    const hashAt = target.indexOf("#");
    const path = hashAt === -1 ? target : target.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : target.slice(hashAt);
    const joiner = path.includes("?") ? "&" : "?";
    return redirect(`${path}${joiner}signin=${encodeURIComponent(reason)}${hash}`, [
      cookieHeader(request, OAUTH_COOKIE, "", 0),
    ]);
  }

  /**
   * The provider was unreachable, or what it sent didn't check out. The screen
   * says the sign-in didn't complete; the operator gets the reason in the log.
   */
  function oidcFailed(request: Request, error: unknown, returnTo?: string): Response {
    console.error(
      "graft studio: OIDC sign-in failed:",
      error instanceof Error ? error.message : error,
    );
    return failed(request, "oidc_refused", returnTo);
  }

  /** Only a path on this origin, so the parameter cannot become an open redirect. */
  function safeReturn(raw: string | null): string {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return ui;
    return raw;
  }

  /**
   * The signed OAuth state cookie set when sign-in started, if it is valid.
   * An OIDC sign-in also keeps its PKCE verifier and nonce there.
   */
  function pendingSignIn(request: Request): PendingSignIn | null {
    return verify<PendingSignIn>(options.secret, "oauth", readCookie(request, OAUTH_COOKIE));
  }

  async function oidcCallback(request: Request, url: URL): Promise<Response> {
    const oidc = options.oidc;
    if (!oidc) return failed(request, "oidc_off");
    const pending = pendingSignIn(request);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!pending?.verifier || !pending.nonce || !state || pending.state !== state) {
      return failed(request, "expired", pending?.return);
    }
    const back = pending.return;
    // The person said no at the provider, or it refused them.
    if (!code) return failed(request, "oidc_refused", back);
    const person = await finishOidcSignIn(oidc, {
      code,
      redirectUri: `${origin(request)}${AUTH}/oidc/callback`,
      verifier: pending.verifier,
      nonce: pending.nonce,
    });
    return oidcSignedIn(request, person, back);
  }

  /**
   * The Studio account a verified email signs in as: the one it already has,
   * or one made now from an open invitation for that email. Inviting someone
   * from People is then all it takes to let them in with single sign-on: no
   * link to pass on, no password to choose.
   */
  async function oidcAccount(email: string, name: string | undefined) {
    if (!accounts) return null;
    const found = await accountForSignIn(accounts.db, email);
    if (found) return found;
    const invited = await acceptInviteForEmail(accounts.db, {
      email,
      ...(name ? { name } : {}),
      // No password yet, and none that could match: password sign-in stays
      // refused until an admin sends them a link to set one.
      passwordHash: NO_PASSWORD,
    });
    return invited.ok ? invited.account : null;
  }

  /**
   * A verified email is who someone is. Their Studio account, or an open
   * invitation, decides their role, and they get the account's revocable
   * session; otherwise GRAFT_STUDIO_EDITORS does. With none of these they are
   * refused: the provider vouches for who someone is, not for whether they
   * belong here.
   */
  async function oidcSignedIn(request: Request, person: OidcPerson, back: string) {
    if (!person.email || !person.emailVerified) return failed(request, "email_unverified", back);
    const email = person.email.toLowerCase();
    const account = await oidcAccount(email, person.name);
    if (account) {
      return redirect(safeReturn(back), [
        await accountSession(request, account),
        cookieHeader(request, OAUTH_COOKIE, "", 0),
      ]);
    }
    const role = editors.get(email);
    if (!role) return failed(request, "oidc_not_allowed", back);
    return signedIn(
      request,
      { id: email, email, ...(person.name ? { name: person.name } : {}), role, via: "oidc" },
      safeReturn(back),
    );
  }

  async function githubCallback(request: Request, url: URL): Promise<Response> {
    const github = options.github;
    if (!github) return failed(request, "github_off");
    const pending = pendingSignIn(request);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!pending || !state || pending.state !== state || !code) {
      return failed(request, "expired", pending?.return);
    }
    const back = pending.return;

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
    if (!exchange.ok || !token) return failed(request, "github_refused", back);

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
    if (!user.login) return failed(request, "github_refused", back);
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

    let role: StudioRole | null;
    try {
      role = await roleFor(user.login, email);
    } catch (error) {
      // The person may well be allowed; the check itself failed. Say so on the
      // sign-in screen, and give the operator the reason in the log.
      console.error(
        `graft studio: could not check ${user.login}'s access:`,
        error instanceof Error ? error.message : error,
      );
      return failed(request, "access_unchecked", back);
    }
    if (!role) return failed(request, "not_allowed", back);
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
    async authenticate(request) {
      const identity = await session(request);
      return identity ? principalFor(identity) : null;
    },

    async handle(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(`${AUTH}/`)) return null;
      const route = `${request.method} ${url.pathname.slice(AUTH.length)}`;

      switch (route) {
        case "GET /session": {
          const identity = await session(request);
          // No accounts yet: the first visit creates the owner.
          const setup = accounts ? (await countAccounts(accounts.db)) === 0 : false;
          return Response.json(
            {
              user: identity ? userJson(identity) : null,
              methods: {
                github: Boolean(options.github),
                oidc: options.oidc ? { name: options.oidc.name ?? null } : null,
                invite: true,
                password: Boolean(accounts),
              },
              setup: setup ? { needsCode: !accounts?.setupWithoutCode } : null,
            },
            { headers: { "cache-control": "no-store" } },
          );
        }

        case "POST /setup":
          return accountRoute(request, url, async (db, input) => {
            if (!accounts?.setupWithoutCode && !setupCodeMatches(options.secret, input.code)) {
              throw new GraftError({
                code: "UNAUTHORIZED",
                message: "That setup code isn't right.",
                fix: "Run graft studio setup-code with this site's settings (it reads GRAFT_STUDIO_SECRET), or ask whoever deployed it. graft serve also prints it when it starts.",
              });
            }
            const email = normaliseEmail(input.email);
            const password = assertPassword(input.password);
            const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
            const owner = await createOwner(db, {
              email,
              ...(name ? { name } : {}),
              passwordHash: await hashPassword(password),
            });
            if (!owner) {
              throw new GraftError({
                code: "UNAUTHORIZED",
                message: "This Studio already has an owner.",
                fix: "Sign in, or ask the owner for an invitation.",
              });
            }
            return accountSignedIn(request, owner);
          });

        case "POST /sign-in":
          return accountRoute(request, url, async (db, input) => {
            const email = typeof input.email === "string" ? input.email.trim() : "";
            const password = typeof input.password === "string" ? input.password : "";
            const found = email ? await accountForSignIn(db, email) : null;
            if (found?.lockedUntil && found.lockedUntil.getTime() > Date.now()) {
              const minutes = Math.ceil((found.lockedUntil.getTime() - Date.now()) / 60_000);
              throw new GraftError({
                code: "RATE_LIMITED",
                message: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
                fix: "Wait, then sign in again. An admin can't unlock it sooner, but can invite you again if you've forgotten your password.",
              });
            }
            // A wrong email is checked against a decoy, so it takes as long
            // to refuse as a wrong password and says nothing about who exists.
            const ok = await verifyPassword(password, found?.passwordHash ?? (await decoyHash()));
            if (found) await recordSignIn(db, found.id, ok, SIGN_IN_LIMITS);
            if (!found || !ok) {
              throw new GraftError({
                code: "UNAUTHORIZED",
                message: "That email and password don't match an account.",
                fix: "Check both and try again. Forgotten your password? Ask an admin to invite you again.",
              });
            }
            return accountSignedIn(request, found);
          });

        case "GET /invite": {
          const token = url.searchParams.get("token") ?? "";
          const invite = accounts && token ? await readInvite(accounts.db, hashToken(token)) : null;
          if (!invite) {
            return errorResponse(
              new GraftError({
                code: "TOKEN_INVALID",
                message: "This invitation was already used, replaced, or has expired.",
                fix: "Ask whoever invited you for a new invitation.",
              }),
              401,
            );
          }
          return Response.json(
            {
              email: invite.email,
              name: invite.name,
              role: invite.role,
              // A link for someone who can already sign in sets a new password.
              reset: accounts ? await hasActiveAccount(accounts.db, invite.email) : false,
            },
            { headers: { "cache-control": "no-store" } },
          );
        }

        case "POST /invite":
          return accountRoute(request, url, async (db, input) => {
            const token = typeof input.token === "string" ? input.token : "";
            const password = assertPassword(input.password);
            const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
            const result = await acceptInvite(db, {
              tokenHash: hashToken(token),
              ...(name ? { name } : {}),
              passwordHash: await hashPassword(password),
            });
            if (!result.ok) {
              throw new GraftError({
                code: "TOKEN_INVALID",
                message: "This link was already used, replaced, or has expired.",
                fix: "Ask whoever sent it for a new one.",
              });
            }
            return accountSignedIn(request, result.account);
          });

        case "POST /password":
          return accountRoute(request, url, async (db, input) => {
            const raw = readCookie(request, SESSION_COOKIE);
            const current = isAccountToken(raw) ? await sessionAccount(db, hashToken(raw)) : null;
            if (!current || !isAccountToken(raw)) {
              throw new GraftError({
                code: "UNAUTHORIZED",
                message: "Only someone signed in with a Studio account has a password to change.",
                fix: "Sign in with your email and password first.",
              });
            }
            const next = assertPassword(input.next);
            const stored = await accountForSignIn(db, current.email);
            const ok = stored
              ? await verifyPassword(
                  typeof input.current === "string" ? input.current : "",
                  stored.passwordHash,
                )
              : false;
            if (!ok) {
              throw new GraftError({
                code: "UNAUTHORIZED",
                message: "Your current password isn't right.",
                fix: "Type the password you signed in with.",
              });
            }
            // Every other browser signed in as this person is signed out.
            await setPassword(db, {
              id: current.id,
              passwordHash: await hashPassword(next),
              keepSession: hashToken(raw),
            });
            return new Response(null, { status: 204 });
          });

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
            // A network failure talking to GitHub: still go back where the
            // person started, if the sign-in got far enough to record it.
            return failed(request, "github_refused", pendingSignIn(request)?.return);
          }

        case "GET /oidc": {
          if (!options.oidc) return failed(request, "oidc_off");
          const state = randomState();
          const back = safeReturn(url.searchParams.get("return"));
          let start: Awaited<ReturnType<typeof startOidcSignIn>>;
          try {
            start = await startOidcSignIn(options.oidc, {
              redirectUri: `${origin(request)}${AUTH}/oidc/callback`,
              state,
            });
          } catch (error) {
            return oidcFailed(request, error, back);
          }
          const pending = sign<PendingSignIn>(
            options.secret,
            "oauth",
            { state, return: back, verifier: start.verifier, nonce: start.nonce },
            10 * 60_000,
          );
          return redirect(start.url, [cookieHeader(request, OAUTH_COOKIE, pending, 10 * 60_000)]);
        }

        case "GET /oidc/callback":
          try {
            return await oidcCallback(request, url);
          } catch (error) {
            return oidcFailed(request, error, pendingSignIn(request)?.return);
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
          const raw = readCookie(request, SESSION_COOKIE);
          if (accounts && isAccountToken(raw)) await deleteSession(accounts.db, hashToken(raw));
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

function accountIdentity(account: StudioAccount): EditorIdentity {
  return {
    id: account.email,
    email: account.email,
    ...(account.name ? { name: account.name } : {}),
    role: account.role,
    via: "account",
  };
}

function userJson(identity: EditorIdentity) {
  return {
    id: identity.id,
    name: identity.name ?? null,
    email: identity.email ?? null,
    role: identity.role,
    via: identity.via,
    scopes: ROLE_SCOPES[identity.role],
  };
}

function accountsOff(): GraftError {
  return new GraftError({
    code: "ROUTE_NOT_FOUND",
    message: "This Studio has no accounts.",
    fix: "Sign in with GitHub or the link you were sent. To turn accounts on, run Studio with graft serve --studio and GRAFT_STUDIO_SECRET set.",
  });
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}
