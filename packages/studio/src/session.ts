/**
 * Who is editing, for a hosted Studio.
 *
 * A browser cannot hold a bearer token for a person, so a hosted Studio needs
 * a session. This one is a signed cookie, not a row: stateless, so it works on
 * serverless with no session table, and on either storage tier.
 *
 * Two credentials share one codec under separate keys, so neither can be
 * replayed as the other: a session (the cookie) and an invite (a link an admin
 * hands a person who has no GitHub account).
 *
 * Trade-off taken knowingly: a session cannot be revoked on its own. Rotating
 * GRAFT_STUDIO_SECRET signs everyone out and voids every unused invite.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isLoopbackHost, withoutTrailingSlashes } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";

/** What a person may do in Studio. Ordered from least to most. */
export const STUDIO_ROLES = ["viewer", "contributor", "editor", "admin"] as const;
export type StudioRole = (typeof STUDIO_ROLES)[number];

/**
 * Roles are names for scope sets; routes still check scopes. A contributor
 * drafts and submits for review, an editor publishes, an admin also decides
 * approvals, manages who has access, and runs the site: its settings, deploy
 * hooks and agent tokens. The familiar split for a content team.
 */
// Frozen, map and arrays alike: it is exported, and it decides what a signed-in
// role may do, so no importer can widen a role at runtime.
export const ROLE_SCOPES: Readonly<Record<StudioRole, readonly string[]>> = Object.freeze({
  viewer: Object.freeze(["studio:read"]),
  contributor: Object.freeze(["studio:read", "studio:write"]),
  editor: Object.freeze(["studio:read", "studio:write", "studio:publish"]),
  admin: Object.freeze([
    "studio:read",
    "studio:write",
    "studio:publish",
    "approvals:decide",
    "studio:people",
    "studio:settings",
  ]),
});

export function isStudioRole(value: unknown): value is StudioRole {
  return typeof value === "string" && (STUDIO_ROLES as readonly string[]).includes(value);
}

export interface EditorIdentity {
  /** GitHub login, or the email of an account, an invite link, Google or an OIDC sign-in. */
  id: string;
  name?: string;
  email?: string;
  role: StudioRole;
  via: "github" | "invite" | "account" | "google" | "oidc";
  /** An account's: whether it has a password to change. */
  password?: boolean;
}

interface Signed<T> {
  /** What the token is for; part of the signed payload. */
  p: "session" | "invite" | "oauth";
  exp: number;
  data: T;
}

export const SESSION_COOKIE = "graft_studio";
export const OAUTH_COOKIE = "graft_studio_oauth";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A secret long enough to sign with, or a refusal that says how to make one. */
export function requireSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: secret
        ? "GRAFT_STUDIO_SECRET is too short to sign sessions with."
        : "GRAFT_STUDIO_SECRET is not set.",
      fix: "Set GRAFT_STUDIO_SECRET to at least 32 random characters, e.g. the output of `openssl rand -base64 48`. Changing it later signs everyone out.",
    });
  }
  return secret;
}

function mac(secret: string, purpose: string, body: string): Buffer {
  // A key per purpose: a session cookie cannot be presented as an invite.
  const key = createHmac("sha256", secret).update(`graft-studio:${purpose}`).digest();
  return createHmac("sha256", key).update(body).digest();
}

export function sign<T>(
  secret: string,
  purpose: Signed<T>["p"],
  data: T,
  ttlMs: number,
  now = Date.now(),
): string {
  const payload: Signed<T> = { p: purpose, exp: now + ttlMs, data };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(secret, purpose, body).toString("base64url")}`;
}

/** The data inside a valid, unexpired token for this purpose, else null. */
export function verify<T>(
  secret: string,
  purpose: Signed<T>["p"],
  token: string | undefined | null,
  now = Date.now(),
): T | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  const expected = mac(secret, purpose, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Signed<T>;
    if (payload.p !== purpose || typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload.data;
  } catch {
    return null;
  }
}

export interface InviteData {
  email: string;
  name?: string;
  role: StudioRole;
}

/** A sign-in link for someone without a GitHub account. */
export function createInviteLink(options: {
  secret: string;
  baseUrl: string;
  email: string;
  name?: string;
  role: StudioRole;
  ttlMs?: number;
}): { url: string; expiresAt: Date } {
  const email = options.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${options.email}" is not an email address.`,
      fix: "Invite people by email: graft studio invite ana@example.com --role editor",
    });
  }
  const ttl = options.ttlMs ?? INVITE_TTL_MS;
  const data: InviteData = {
    email,
    role: options.role,
    ...(options.name?.trim() ? { name: options.name.trim() } : {}),
  };
  const token = sign(requireSecret(options.secret), "invite", data, ttl);
  const base = withoutTrailingSlashes(options.baseUrl);
  return {
    url: `${base}/api/studio/v1/auth/link?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(Date.now() + ttl),
  };
}

export function randomState(): string {
  return randomBytes(18).toString("base64url");
}

/* ---- cookies ------------------------------------------------------------- */

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * `Secure` everywhere except plain-http loopback, where a browser would drop
 * it and local testing could not sign in. HttpOnly so script on the page never
 * sees it; SameSite=Lax so a cross-site POST never carries it, on top of the
 * API's own same-origin check.
 */
export function cookieHeader(
  request: Request,
  name: string,
  value: string,
  maxAgeMs: number,
): string {
  const url = new URL(request.url);
  const loopback = isLoopbackHost(url.hostname);
  const secure = url.protocol === "https:" || !loopback;
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/* ---- access ---------------------------------------------------------------- */

/**
 * `GRAFT_STUDIO_EDITORS`: who may sign in, and as what.
 * Comma-separated logins or emails, each optionally `=role` (default editor):
 * `ana@shop.com=admin, octocat, ben@shop.com=contributor`.
 */
export function parseEditorList(raw: string | undefined): Map<string, StudioRole> {
  const out = new Map<string, StudioRole>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [who, role] = trimmed.split("=").map((part) => part.trim());
    if (!who) continue;
    if (role !== undefined && !isStudioRole(role)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `GRAFT_STUDIO_EDITORS gives "${who}" the role "${role}".`,
        fix: `Roles are ${STUDIO_ROLES.join(", ")}.`,
      });
    }
    out.set(who.toLowerCase(), role ?? "editor");
  }
  return out;
}

/** Anyone with a verified email at `domain` joins with `role`, without an invitation. */
export interface AutoJoinRule {
  domain: string;
  role: Exclude<StudioRole, "admin">;
}

/**
 * Free mail providers, where anyone can make an address. A rule for one of
 * them would let in the whole internet.
 */
const OPEN_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
]);

/**
 * `GRAFT_STUDIO_AUTO_JOIN`: email domains whose people join on their own.
 * Comma-separated domains, each optionally `=role` (default contributor):
 * `shop.example.com=editor, agency.example=viewer`. Admin is never given
 * this way: admins are invited.
 */
export function parseAutoJoin(raw: string | undefined): AutoJoinRule[] {
  const rules: AutoJoinRule[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [rawDomain = "", rawRole] = trimmed.split("=").map((part) => part.trim());
    const domain = rawDomain.replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `GRAFT_STUDIO_AUTO_JOIN has "${rawDomain}", which isn't an email domain.`,
        fix: 'List domains, each with an optional role: GRAFT_STUDIO_AUTO_JOIN="shop.example.com=contributor".',
      });
    }
    if (OPEN_MAIL_DOMAINS.has(domain)) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `GRAFT_STUDIO_AUTO_JOIN has ${domain}, where anyone can make an address, so anyone could join.`,
        fix: "Use your organisation's own domain, or invite people one by one in Settings, People.",
      });
    }
    const role = rawRole ?? "contributor";
    if (!isStudioRole(role) || role === "admin") {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `GRAFT_STUDIO_AUTO_JOIN gives ${domain} the role "${role}".`,
        fix:
          role === "admin"
            ? "Nobody joins as an admin on their own. Give the domain viewer, contributor or editor, and invite admins in Settings, People."
            : "Roles for a domain are viewer, contributor and editor.",
      });
    }
    rules.push({ domain, role });
  }
  return rules;
}

/** The rule a verified email falls under, if any. */
export function autoJoinRule(
  rules: readonly AutoJoinRule[],
  email: string,
): AutoJoinRule | undefined {
  const at = email.lastIndexOf("@");
  const domain = at === -1 ? "" : email.slice(at + 1).toLowerCase();
  return rules.find((rule) => rule.domain === domain);
}

/** The Studio role a repository permission earns, when no list is configured. */
export function roleForRepoPermission(permission: string): StudioRole | null {
  if (permission === "admin") return "admin";
  if (permission === "maintain" || permission === "write") return "editor";
  return null;
}

/** Every variable sign-in reads, for docs and turbo's env lists. */
export const EDITOR_AUTH_ENV = [
  "GRAFT_STUDIO_SECRET",
  "GRAFT_STUDIO_URL",
  "GRAFT_STUDIO_EDITORS",
  "GRAFT_STUDIO_AUTO_JOIN",
  "GRAFT_GITHUB_CLIENT_ID",
  "GRAFT_GITHUB_CLIENT_SECRET",
  "GRAFT_GOOGLE_CLIENT_ID",
  "GRAFT_GOOGLE_CLIENT_SECRET",
  "GRAFT_OIDC_ISSUER",
  "GRAFT_OIDC_CLIENT_ID",
  "GRAFT_OIDC_CLIENT_SECRET",
  "GRAFT_OIDC_NAME",
] as const;

export interface EditorAccessConfig {
  secret: string;
  publicUrl?: string;
  editors: Map<string, StudioRole>;
  autoJoin: AutoJoinRule[];
  github?: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  oidc?: { issuer: string; clientId: string; clientSecret: string; name?: string };
}

/** A provider's client ID and secret: both, or neither. */
function clientFromEnv(
  env: Record<string, string | undefined>,
  provider: "GOOGLE",
  where: string,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = env[`GRAFT_${provider}_CLIENT_ID`]?.trim();
  const clientSecret = env[`GRAFT_${provider}_CLIENT_SECRET`]?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: `Only one of GRAFT_${provider}_CLIENT_ID and GRAFT_${provider}_CLIENT_SECRET is set.`,
      fix: `Set both from the ${where}, or neither.`,
    });
  }
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

const OIDC_ENV = ["GRAFT_OIDC_ISSUER", "GRAFT_OIDC_CLIENT_ID", "GRAFT_OIDC_CLIENT_SECRET"] as const;

/**
 * OIDC sign-in from the environment: all three variables or none. The issuer
 * is https, or http on this computer for trying a provider out locally.
 */
function oidcFromEnv(
  env: Record<string, string | undefined>,
): EditorAccessConfig["oidc"] | undefined {
  const set = OIDC_ENV.filter((name) => env[name]?.trim());
  if (set.length === 0) return undefined;
  if (set.length < OIDC_ENV.length) {
    const missing = OIDC_ENV.filter((name) => !set.includes(name));
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: `OIDC sign-in is half set up: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing.`,
      fix: "Set GRAFT_OIDC_ISSUER, GRAFT_OIDC_CLIENT_ID and GRAFT_OIDC_CLIENT_SECRET from the client you registered with your provider, or none of them.",
      details: { missing },
    });
  }
  const issuer = env.GRAFT_OIDC_ISSUER?.trim() ?? "";
  let url: URL | null = null;
  try {
    url = new URL(issuer);
  } catch {
    url = null;
  }
  if (
    !url ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname)))
  ) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `GRAFT_OIDC_ISSUER is "${issuer}", which isn't an https URL.`,
      fix: "Set it to your provider's issuer URL, the one its tokens carry in iss, such as https://auth.example.com/api/auth. Plain http works only on localhost.",
      details: { variable: "GRAFT_OIDC_ISSUER", value: issuer },
    });
  }
  const name = env.GRAFT_OIDC_NAME?.trim();
  return {
    issuer,
    clientId: env.GRAFT_OIDC_CLIENT_ID?.trim() ?? "",
    clientSecret: env.GRAFT_OIDC_CLIENT_SECRET?.trim() ?? "",
    ...(name ? { name } : {}),
  };
}

/**
 * Sign-in settings from the environment, or undefined when sign-in is off
 * (GRAFT_STUDIO_SECRET unset). Half a GitHub or OIDC configuration is refused
 * rather than silently ignored: a missing sign-in button is a confusing failure.
 */
export function editorAccessFromEnv(
  env: Record<string, string | undefined> = process.env,
): EditorAccessConfig | undefined {
  if (!env.GRAFT_STUDIO_SECRET) return undefined;
  const secret = requireSecret(env.GRAFT_STUDIO_SECRET);
  const clientId = env.GRAFT_GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GRAFT_GITHUB_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "Only one of GRAFT_GITHUB_CLIENT_ID and GRAFT_GITHUB_CLIENT_SECRET is set.",
      fix: "Set both from your GitHub OAuth app (Settings > Developer settings > OAuth Apps), or neither to use invite links only.",
    });
  }
  const google = clientFromEnv(
    env,
    "GOOGLE",
    "Google Cloud console (APIs & Services > Credentials > OAuth client ID, type Web application)",
  );
  const publicUrl = withoutTrailingSlashes(env.GRAFT_STUDIO_URL?.trim() ?? "") || undefined;
  const oidc = oidcFromEnv(env);
  return {
    secret,
    ...(publicUrl ? { publicUrl } : {}),
    editors: parseEditorList(env.GRAFT_STUDIO_EDITORS),
    autoJoin: parseAutoJoin(env.GRAFT_STUDIO_AUTO_JOIN),
    ...(clientId && clientSecret ? { github: { clientId, clientSecret } } : {}),
    ...(google ? { google } : {}),
    ...(oidc ? { oidc } : {}),
  };
}
