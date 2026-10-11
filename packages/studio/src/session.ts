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
 * approvals: the familiar split for a content team.
 */
// Frozen, map and arrays alike: it is exported, and it decides what a signed-in
// role may do, so no importer can widen a role at runtime.
export const ROLE_SCOPES: Readonly<Record<StudioRole, readonly string[]>> = Object.freeze({
  viewer: Object.freeze(["studio:read"]),
  contributor: Object.freeze(["studio:read", "studio:write"]),
  editor: Object.freeze(["studio:read", "studio:write", "studio:publish"]),
  admin: Object.freeze(["studio:read", "studio:write", "studio:publish", "approvals:decide"]),
});

export function isStudioRole(value: unknown): value is StudioRole {
  return typeof value === "string" && (STUDIO_ROLES as readonly string[]).includes(value);
}

export interface EditorIdentity {
  /** GitHub login, or the invited email. */
  id: string;
  name?: string;
  email?: string;
  role: StudioRole;
  via: "github" | "invite";
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
  "GRAFT_GITHUB_CLIENT_ID",
  "GRAFT_GITHUB_CLIENT_SECRET",
] as const;

export interface EditorAccessConfig {
  secret: string;
  publicUrl?: string;
  editors: Map<string, StudioRole>;
  github?: { clientId: string; clientSecret: string };
}

/**
 * Sign-in settings from the environment, or undefined when sign-in is off
 * (GRAFT_STUDIO_SECRET unset). Half a GitHub configuration is refused rather
 * than silently ignored: a missing sign-in button is a confusing failure.
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
  const publicUrl = withoutTrailingSlashes(env.GRAFT_STUDIO_URL?.trim() ?? "") || undefined;
  return {
    secret,
    ...(publicUrl ? { publicUrl } : {}),
    editors: parseEditorList(env.GRAFT_STUDIO_EDITORS),
    ...(clientId && clientSecret ? { github: { clientId, clientSecret } } : {}),
  };
}
