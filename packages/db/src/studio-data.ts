/**
 * What Studio keeps besides content and accounts: the media catalogue, the
 * tokens an admin made for agents, the site's settings and its deploy hooks.
 * None of it is branch-scoped: one bucket, one site, one set of agents.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  agentTokens,
  assets,
  deployHooks,
  siteSettings,
  type AgentTokenRow,
  type AssetRow,
  type DeployHookRow,
  type SiteSettingsRow,
} from "./schema";

/* ---- media ------------------------------------------------------------- */

export interface AssetInput {
  key: string;
  contentType: string;
  bytes: number;
  alt?: string | null;
  uploadedBy?: { id: string; name?: string | null };
}

/** Record an uploaded file, or refresh the record of one uploaded again. */
export async function recordAsset(db: Database, input: AssetInput): Promise<AssetRow> {
  const values = {
    key: input.key,
    contentType: input.contentType,
    bytes: input.bytes,
    ...(input.alt !== undefined ? { alt: input.alt } : {}),
    uploadedById: input.uploadedBy?.id ?? null,
    uploadedByName: input.uploadedBy?.name ?? null,
  };
  const [row] = await db
    .insert(assets)
    .values(values)
    .onConflictDoUpdate({
      target: assets.key,
      set: {
        contentType: values.contentType,
        bytes: values.bytes,
        uploadedById: values.uploadedById,
        uploadedByName: values.uploadedByName,
        updatedAt: sql`now()`,
        // A new upload under the same key keeps the alt text written for it.
        ...(input.alt !== undefined ? { alt: input.alt } : {}),
      },
    })
    .returning();
  return row as AssetRow;
}

/** The catalogue, newest first, optionally only keys or alt text matching `q`. */
export async function listAssets(
  db: Database,
  options: { q?: string; limit?: number } = {},
): Promise<AssetRow[]> {
  const q = options.q?.trim();
  const match = q
    ? or(ilike(assets.key, `%${escapeLike(q)}%`), ilike(assets.alt, `%${escapeLike(q)}%`))
    : undefined;
  return db
    .select()
    .from(assets)
    .where(match)
    .orderBy(desc(assets.createdAt), asc(assets.key))
    .limit(options.limit ?? 500);
}

export async function readAsset(db: Database, key: string): Promise<AssetRow | null> {
  const [row] = await db.select().from(assets).where(eq(assets.key, key));
  return row ?? null;
}

/** Set the alt text offered for a file. False when there is no such file. */
export async function setAssetAlt(db: Database, key: string, alt: string | null): Promise<boolean> {
  const rows = await db
    .update(assets)
    .set({ alt, updatedAt: sql`now()` })
    .where(eq(assets.key, key))
    .returning({ key: assets.key });
  return rows.length > 0;
}

export async function forgetAsset(db: Database, key: string): Promise<void> {
  await db.delete(assets).where(eq(assets.key, key));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ---- agent tokens -------------------------------------------------------- */

/** Every token Studio mints starts with this, so a leaked one is recognisable. */
export const AGENT_TOKEN_PREFIX = "graft_at_";

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new token: shown to the person once, stored only as its hash. */
export function mintAgentToken(): { token: string; tokenHash: string; prefix: string } {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashAgentToken(token), prefix: token.slice(0, 13) };
}

/**
 * Who a bearer token is, when it is a live one Studio minted: an agent named
 * after the token, with its scopes. Null for anything else, so the caller
 * can try the next kind of credential.
 */
export async function actorForAgentToken(
  db: Database,
  token: string,
): Promise<{ kind: "agent"; id: string; scopes: string[] } | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const row = await agentForToken(db, hashAgentToken(token));
  return row ? { kind: "agent", id: `token:${row.name}`, scopes: row.scopes } : null;
}

export interface AgentTokenInput {
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  createdById?: string | null;
}

export async function createAgentToken(
  db: Database,
  input: AgentTokenInput,
): Promise<AgentTokenRow> {
  const [row] = await db
    .insert(agentTokens)
    .values({ ...input, createdById: input.createdById ?? null })
    .returning();
  return row as AgentTokenRow;
}

/** Every token, revoked ones too, newest first: what was given out stays on record. */
export async function listAgentTokens(db: Database): Promise<AgentTokenRow[]> {
  return db.select().from(agentTokens).orderBy(desc(agentTokens.createdAt));
}

/** Revoke a token. False when there is no such token or it was revoked already. */
export async function revokeAgentToken(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(agentTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
    .returning({ id: agentTokens.id });
  return rows.length > 0;
}

/**
 * The live token with this hash, or null. Marks it used, at most once a
 * minute, so a busy agent doesn't write on every request.
 */
export async function agentForToken(
  db: Database,
  tokenHash: string,
): Promise<AgentTokenRow | null> {
  const [row] = await db
    .select()
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, tokenHash), isNull(agentTokens.revokedAt)));
  if (!row) return null;
  await db
    .update(agentTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(agentTokens.id, row.id),
        or(
          isNull(agentTokens.lastUsedAt),
          lt(agentTokens.lastUsedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
  return row;
}

/* ---- site settings ------------------------------------------------------- */

export async function readSiteSettings(db: Database): Promise<SiteSettingsRow | null> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, "site"));
  return row ?? null;
}

export async function writeSiteSettings(
  db: Database,
  input: { name: string | null; url: string | null; updatedById: string },
): Promise<SiteSettingsRow> {
  const [row] = await db
    .insert(siteSettings)
    .values({ id: "site", ...input })
    .onConflictDoUpdate({
      target: siteSettings.id,
      set: { ...input, updatedAt: sql`now()` },
    })
    .returning();
  return row as SiteSettingsRow;
}

/* ---- deploy hooks -------------------------------------------------------- */

export async function listDeployHooks(db: Database): Promise<DeployHookRow[]> {
  return db.select().from(deployHooks).orderBy(asc(deployHooks.createdAt));
}

export async function createDeployHook(
  db: Database,
  input: { name: string; url: string; secret: string | null },
): Promise<DeployHookRow> {
  const [row] = await db.insert(deployHooks).values(input).returning();
  return row as DeployHookRow;
}

export async function deleteDeployHook(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .delete(deployHooks)
    .where(eq(deployHooks.id, id))
    .returning({ id: deployHooks.id });
  return rows.length > 0;
}

/** What the last call to a hook answered: an HTTP status, or the error that stopped it. */
export async function recordDeployHookDelivery(
  db: Database,
  id: string,
  result: { status: number | null; error: string | null },
): Promise<void> {
  await db
    .update(deployHooks)
    .set({ lastAt: sql`now()`, lastStatus: result.status, lastError: result.error })
    .where(eq(deployHooks.id, id));
}
