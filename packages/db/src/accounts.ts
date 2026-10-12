/**
 * Studio accounts: people who sign in with an email and password, the
 * sessions their browsers hold, and the invitations that bring them in.
 *
 * Passwords are hashed by the caller (Studio), so this module never sees one.
 * Session and invite tokens arrive as SHA-256 hashes for the same reason: a
 * copy of these tables signs nobody in.
 */
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { studioInvites, studioSessions, studioUsers, type StudioUserRow } from "./schema";

export type AccountRole = "viewer" | "contributor" | "editor" | "admin";

export interface StudioAccount {
  id: string;
  email: string;
  name: string | null;
  role: AccountRole;
  owner: boolean;
  createdAt: Date;
}

export interface StudioInvite {
  id: string;
  email: string;
  name: string | null;
  role: AccountRole;
  invitedById: string | null;
  createdAt: Date;
  expiresAt: Date;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function account(row: StudioUserRow): StudioAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AccountRole,
    owner: row.owner,
    createdAt: row.createdAt,
  };
}

function invite(row: typeof studioInvites.$inferSelect): StudioInvite {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AccountRole,
    invitedById: row.invitedById,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** Serialises changes to who has access, so two requests can't both pass a "last admin" check. */
async function lockAccounts(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('graft-studio-accounts'))`);
}

const active = isNull(studioUsers.disabledAt);
const sameEmail = (email: string) => sql`lower(${studioUsers.email}) = lower(${email})`;

/** How many people can sign in. Zero means Studio is waiting for its owner. */
export async function countAccounts(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(studioUsers)
    .where(active);
  return row?.n ?? 0;
}

/**
 * The first account, an admin marked as the owner. Null when someone got
 * there first: there is only ever one first visit.
 */
export async function createOwner(
  db: Database,
  input: { email: string; name?: string; passwordHash: string },
): Promise<StudioAccount | null> {
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const [existing] = await tx.select({ id: studioUsers.id }).from(studioUsers).limit(1);
    if (existing) return null;
    const [row] = await tx
      .insert(studioUsers)
      .values({
        email: input.email,
        name: input.name ?? null,
        role: "admin",
        owner: true,
        passwordHash: input.passwordHash,
      })
      .returning();
    return row ? account(row) : null;
  });
}

/** The account an email signs in to, with what checking a password needs. */
export async function accountForSignIn(
  db: Database,
  email: string,
): Promise<(StudioAccount & { passwordHash: string; lockedUntil: Date | null }) | null> {
  const [row] = await db
    .select()
    .from(studioUsers)
    .where(and(sameEmail(email), active))
    .limit(1);
  return row
    ? { ...account(row), passwordHash: row.passwordHash, lockedUntil: row.lockedUntil }
    : null;
}

/**
 * Count a sign-in attempt. Every `maxFailures` wrong passwords in a row lock
 * the account for `lockMs`; a right one resets the count.
 */
export async function recordSignIn(
  db: Database,
  id: string,
  succeeded: boolean,
  limits: { maxFailures: number; lockMs: number },
): Promise<void> {
  if (succeeded) {
    await db
      .update(studioUsers)
      .set({ failedSignIns: 0, lockedUntil: null })
      .where(eq(studioUsers.id, id));
    return;
  }
  await db
    .update(studioUsers)
    .set({
      failedSignIns: sql`case when ${studioUsers.failedSignIns} + 1 >= ${limits.maxFailures} then 0 else ${studioUsers.failedSignIns} + 1 end`,
      lockedUntil: sql`case when ${studioUsers.failedSignIns} + 1 >= ${limits.maxFailures} then now() + make_interval(secs => ${limits.lockMs / 1000}) else ${studioUsers.lockedUntil} end`,
    })
    .where(eq(studioUsers.id, id));
}

/* ---- sessions -------------------------------------------------------------- */

export async function createSession(
  db: Database,
  input: { tokenHash: string; userId: string; expiresAt: Date },
): Promise<void> {
  await db.insert(studioSessions).values(input);
}

/** The account behind a session, while the session is unexpired and the account active. */
export async function sessionAccount(
  db: Database,
  tokenHash: string,
): Promise<StudioAccount | null> {
  const [row] = await db
    .select({ user: studioUsers })
    .from(studioSessions)
    .innerJoin(studioUsers, eq(studioUsers.id, studioSessions.userId))
    .where(
      and(
        eq(studioSessions.tokenHash, tokenHash),
        gt(studioSessions.expiresAt, sql`now()`),
        active,
      ),
    )
    .limit(1);
  return row ? account(row.user) : null;
}

export async function deleteSession(db: Database, tokenHash: string): Promise<void> {
  await db.delete(studioSessions).where(eq(studioSessions.tokenHash, tokenHash));
}

/* ---- people ---------------------------------------------------------------- */

/** Everyone who can sign in, the owner first. */
export async function listAccounts(db: Database): Promise<StudioAccount[]> {
  const rows = await db
    .select()
    .from(studioUsers)
    .where(active)
    .orderBy(sql`${studioUsers.owner} desc`, asc(studioUsers.createdAt));
  return rows.map(account);
}

export type AccessChange = { ok: true } | { ok: false; reason: "not-found" | "last-admin" };

async function activeAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: studioUsers.id })
    .from(studioUsers)
    .where(and(eq(studioUsers.role, "admin"), active));
  return rows.map((row) => row.id);
}

/** Change what someone may do. The last admin can't be demoted: someone must be able to invite. */
export async function setAccountRole(
  db: Database,
  id: string,
  role: AccountRole,
): Promise<AccessChange> {
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const [row] = await tx
      .select({ role: studioUsers.role })
      .from(studioUsers)
      .where(and(eq(studioUsers.id, id), active));
    if (!row) return { ok: false, reason: "not-found" } as const;
    if (row.role === "admin" && role !== "admin") {
      const admins = await activeAdmins(tx);
      if (admins.length <= 1) return { ok: false, reason: "last-admin" } as const;
    }
    await tx
      .update(studioUsers)
      .set({ role, updatedAt: sql`now()` })
      .where(eq(studioUsers.id, id));
    return { ok: true } as const;
  });
}

/**
 * Take someone's access away: the account is disabled, never deleted, so what
 * they did stays attributed, and their sessions end now.
 */
export async function disableAccount(db: Database, id: string): Promise<AccessChange> {
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const [row] = await tx
      .select({ role: studioUsers.role })
      .from(studioUsers)
      .where(and(eq(studioUsers.id, id), active));
    if (!row) return { ok: false, reason: "not-found" } as const;
    if (row.role === "admin" && (await activeAdmins(tx)).length <= 1) {
      return { ok: false, reason: "last-admin" } as const;
    }
    await tx
      .update(studioUsers)
      .set({ disabledAt: sql`now()`, owner: false, updatedAt: sql`now()` })
      .where(eq(studioUsers.id, id));
    await tx.delete(studioSessions).where(eq(studioSessions.userId, id));
    return { ok: true } as const;
  });
}

/** Replace a password and end every other session the account has. */
export async function setPassword(
  db: Database,
  input: { id: string; passwordHash: string; keepSession?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(studioUsers)
      .set({ passwordHash: input.passwordHash, updatedAt: sql`now()` })
      .where(eq(studioUsers.id, input.id));
    await tx
      .delete(studioSessions)
      .where(
        and(
          eq(studioSessions.userId, input.id),
          input.keepSession ? sql`${studioSessions.tokenHash} <> ${input.keepSession}` : undefined,
        ),
      );
  });
}

/* ---- invitations ----------------------------------------------------------- */

const open = and(
  isNull(studioInvites.acceptedAt),
  isNull(studioInvites.revokedAt),
  gt(studioInvites.expiresAt, sql`now()`),
);

/** Invitations nobody has used yet, newest first. */
export async function openInvites(db: Database): Promise<StudioInvite[]> {
  const rows = await db
    .select()
    .from(studioInvites)
    .where(open)
    .orderBy(sql`${studioInvites.createdAt} desc`);
  return rows.map(invite);
}

/**
 * Invite someone. Refused when they can already sign in; an earlier open
 * invitation to the same address is replaced, so only the newest link works.
 */
export async function createInvite(
  db: Database,
  input: {
    email: string;
    name?: string;
    role: AccountRole;
    tokenHash: string;
    invitedById: string | null;
    expiresAt: Date;
  },
): Promise<{ ok: true; invite: StudioInvite } | { ok: false; reason: "has-account" }> {
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const [existing] = await tx
      .select({ id: studioUsers.id })
      .from(studioUsers)
      .where(and(sameEmail(input.email), active));
    if (existing) return { ok: false, reason: "has-account" } as const;
    return { ok: true, invite: await replaceInvite(tx, input) } as const;
  });
}

/**
 * A link that sets a new password for someone who has forgotten theirs. It is
 * an invitation to their own account: using it keeps their role and signs
 * out every browser they were signed in on.
 */
export async function createPasswordReset(
  db: Database,
  input: { accountId: string; tokenHash: string; invitedById: string | null; expiresAt: Date },
): Promise<{ ok: true; invite: StudioInvite } | { ok: false; reason: "not-found" }> {
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const [row] = await tx
      .select()
      .from(studioUsers)
      .where(and(eq(studioUsers.id, input.accountId), active));
    if (!row) return { ok: false, reason: "not-found" } as const;
    const invite = await replaceInvite(tx, {
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      role: row.role as AccountRole,
      tokenHash: input.tokenHash,
      invitedById: input.invitedById,
      expiresAt: input.expiresAt,
    });
    return { ok: true, invite } as const;
  });
}

async function replaceInvite(
  tx: Tx,
  input: {
    email: string;
    name?: string;
    role: AccountRole;
    tokenHash: string;
    invitedById: string | null;
    expiresAt: Date;
  },
): Promise<StudioInvite> {
  await tx
    .update(studioInvites)
    .set({ revokedAt: sql`now()` })
    .where(and(sql`lower(${studioInvites.email}) = lower(${input.email})`, open));
  const [row] = await tx
    .insert(studioInvites)
    .values({
      email: input.email,
      name: input.name ?? null,
      role: input.role,
      tokenHash: input.tokenHash,
      invitedById: input.invitedById,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return invite(row);
}

/** Whether an email already belongs to someone who can sign in: a link for it is a reset. */
export async function hasActiveAccount(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: studioUsers.id })
    .from(studioUsers)
    .where(and(sameEmail(email), active))
    .limit(1);
  return Boolean(row);
}

/** The open invitation a link's token names, or null when it is used, revoked or expired. */
export async function readInvite(db: Database, tokenHash: string): Promise<StudioInvite | null> {
  const [row] = await db
    .select()
    .from(studioInvites)
    .where(and(eq(studioInvites.tokenHash, tokenHash), open))
    .limit(1);
  return row ? invite(row) : null;
}

export async function revokeInvite(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(studioInvites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(studioInvites.id, id), open))
    .returning({ id: studioInvites.id });
  return rows.length > 0;
}

/**
 * Use an invitation. One use: it is locked and marked accepted in the same
 * transaction. For a new address it creates the account. For someone who can
 * already sign in it is a password reset: the role stays, and every other
 * session ends. Someone whose access was taken away and who is invited again
 * gets their old account back, so their history stays theirs.
 */
export async function acceptInvite(
  db: Database,
  input: { tokenHash: string; name?: string; passwordHash: string },
): Promise<{ ok: true; account: StudioAccount } | { ok: false; reason: "invalid" }> {
  return db.transaction(async (tx) => {
    await lockAccounts(tx);
    const [row] = await tx
      .select()
      .from(studioInvites)
      .where(and(eq(studioInvites.tokenHash, input.tokenHash), open))
      .for("update");
    if (!row) return { ok: false, reason: "invalid" } as const;
    const [current] = await tx.select().from(studioUsers).where(sameEmail(row.email)).limit(1);
    const name = input.name?.trim() || current?.name || row.name;
    const reset = Boolean(current && !current.disabledAt);
    const [saved] = current
      ? await tx
          .update(studioUsers)
          .set({
            name,
            ...(reset ? {} : { role: row.role }),
            passwordHash: input.passwordHash,
            disabledAt: null,
            failedSignIns: 0,
            lockedUntil: null,
            updatedAt: sql`now()`,
          })
          .where(eq(studioUsers.id, current.id))
          .returning()
      : await tx
          .insert(studioUsers)
          .values({ email: row.email, name, role: row.role, passwordHash: input.passwordHash })
          .returning();
    if (current) await tx.delete(studioSessions).where(eq(studioSessions.userId, current.id));
    await tx
      .update(studioInvites)
      .set({ acceptedAt: sql`now()` })
      .where(eq(studioInvites.id, row.id));
    if (!saved) throw new Error("account write returned no row");
    return { ok: true, account: account(saved) } as const;
  });
}
