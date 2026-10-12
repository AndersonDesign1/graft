/**
 * The secrets behind Studio accounts: password hashes, session and invite
 * tokens, and the setup code that guards a hosted Studio's first visit.
 *
 * Passwords are hashed with scrypt, which ships with Node: no native module to
 * build, so it runs wherever Studio runs. Tokens are random, and only their
 * SHA-256 reaches the database.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { GraftError } from "@usegraft/contracts";

/** scrypt's work factor: about 50ms a hash on a laptop, and 32MB of memory. */
const COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 256;

/** What a session token starts with, so it is never mistaken for a signed cookie. */
const ACCOUNT_TOKEN_PREFIX = "acct_";

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Refuse a password too short to protect anything, with the rule in the fix. */
export function assertPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `A password needs at least ${PASSWORD_MIN} characters.`,
      fix: `Choose a longer password. A few unrelated words make one that is easy to remember.`,
    });
  }
  if (password.length > PASSWORD_MAX) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `A password can be at most ${PASSWORD_MAX} characters.`,
      fix: "Choose a shorter password.",
    });
  }
  return password;
}

/** `scrypt$N$r$p$salt$hash`, so the cost can rise later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A hash that matches no password, checked when an email has no account, so
 * a wrong email takes as long to refuse as a wrong password.
 */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString("base64url"));
  return decoy;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh token for a session or an invitation, and the hash the database keeps. */
export function newToken(): { token: string; hash: string } {
  const token = `${ACCOUNT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function isAccountToken(value: string | undefined): value is string {
  return value?.startsWith(ACCOUNT_TOKEN_PREFIX) === true;
}

/**
 * The code a hosted Studio asks for before it creates its owner account, so
 * whoever finds a fresh deployment first can't claim it. Derived from
 * GRAFT_STUDIO_SECRET, so anyone with the site's environment can print it
 * (`graft studio setup-code`) and nobody else can guess it.
 */
export function setupCode(secret: string): string {
  const digest = createHmac("sha256", secret).update("graft-studio:setup").digest();
  // Crockford's base32 alphabet: no I, L, O or U to misread.
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[(digest[i] ?? 0) % 32];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Compare a typed setup code with the real one, forgiving case, spaces and dashes. */
export function setupCodeMatches(secret: string, typed: unknown): boolean {
  if (typeof typed !== "string") return false;
  const clean = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const want = Buffer.from(clean(setupCode(secret)));
  const got = Buffer.from(clean(typed));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A trimmed, lower-cased email address, or a refusal. */
export function normaliseEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${typeof value === "string" ? value : ""}" is not an email address.`,
      fix: "Enter an email address, such as ana@example.com.",
    });
  }
  return email;
}
