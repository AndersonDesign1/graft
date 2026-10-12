/**
 * Integration: the media catalogue, agent tokens, site settings and deploy
 * hooks against a live database (opt-in), in a throwaway database of their
 * own, since none of them belongs to a branch.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { createScratchDatabase, type ScratchDatabase } from "./scratch-database";
import {
  actorForAgentToken,
  agentForToken,
  createAgentToken,
  createDeployHook,
  deleteDeployHook,
  forgetAsset,
  listAgentTokens,
  listAssets,
  listDeployHooks,
  mintAgentToken,
  readAsset,
  readSiteSettings,
  recordAsset,
  recordDeployHookDelivery,
  revokeAgentToken,
  setAssetAlt,
  writeSiteSettings,
} from "./studio-data";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TIMEOUT = 60_000;

describe.skipIf(!runIntegration)("Studio media, agents and settings (live)", () => {
  let scratch: ScratchDatabase | null;
  let db: Database;

  beforeAll(async () => {
    scratch = await createScratchDatabase(process.env.DATABASE_URL as string);
    if (scratch) db = scratch.handle.db;
  }, TIMEOUT);
  afterAll(async () => {
    await scratch?.drop();
  }, TIMEOUT);

  it("catalogues files, keeps their alt text across a re-upload, and searches them", async (ctx) => {
    if (!scratch) return ctx.skip();
    const ana = { id: "ana", name: "Ana" };
    await recordAsset(db, {
      key: "img/hat.jpg",
      contentType: "image/jpeg",
      bytes: 10,
      uploadedBy: ana,
    });
    await recordAsset(db, {
      key: "img/shirt.png",
      contentType: "image/png",
      bytes: 20,
      alt: "A blue shirt",
    });
    expect(await setAssetAlt(db, "img/hat.jpg", "A wool hat")).toBe(true);
    expect(await setAssetAlt(db, "img/none.jpg", "x")).toBe(false);

    const again = await recordAsset(db, {
      key: "img/hat.jpg",
      contentType: "image/jpeg",
      bytes: 12,
    });
    expect(again).toMatchObject({ bytes: 12, alt: "A wool hat" });

    expect((await listAssets(db)).map((a) => a.key)).toEqual(["img/shirt.png", "img/hat.jpg"]);
    expect((await listAssets(db, { q: "wool" })).map((a) => a.key)).toEqual(["img/hat.jpg"]);
    expect((await listAssets(db, { q: "%" })).map((a) => a.key)).toEqual([]);

    await forgetAsset(db, "img/hat.jpg");
    expect(await readAsset(db, "img/hat.jpg")).toBeNull();
  });

  it("finds a live agent token by its hash, and never a revoked one", async (ctx) => {
    if (!scratch) return ctx.skip();
    const token = await createAgentToken(db, {
      name: "Docs agent",
      tokenHash: "hash-1",
      prefix: "graft_at_ab",
      scopes: ["studio:read"],
    });
    const found = await agentForToken(db, "hash-1");
    expect(found).toMatchObject({ name: "Docs agent", scopes: ["studio:read"] });
    expect((await listAgentTokens(db))[0]?.lastUsedAt).not.toBeNull();
    expect(await agentForToken(db, "hash-2")).toBeNull();

    expect(await revokeAgentToken(db, token.id)).toBe(true);
    expect(await revokeAgentToken(db, token.id)).toBe(false);
    expect(await agentForToken(db, "hash-1")).toBeNull();
    // Revoked tokens stay listed: what was given out stays on record.
    expect((await listAgentTokens(db)).map((t) => t.revokedAt === null)).toEqual([false]);
  });

  it("turns a minted token into an agent, and nothing else into one", async (ctx) => {
    if (!scratch) return ctx.skip();
    const minted = mintAgentToken();
    expect(minted.token).toMatch(/^graft_at_[A-Za-z0-9_-]{43}$/);
    await createAgentToken(db, {
      name: "Shop agent",
      tokenHash: minted.tokenHash,
      prefix: minted.prefix,
      scopes: ["studio:read", "content:write"],
    });
    expect(await actorForAgentToken(db, minted.token)).toEqual({
      kind: "agent",
      id: "token:Shop agent",
      scopes: ["studio:read", "content:write"],
    });
    expect(await actorForAgentToken(db, "graft_at_nope")).toBeNull();
    expect(await actorForAgentToken(db, "a.jwt.token")).toBeNull();
  });

  it("keeps one row of site settings, and records each hook's last delivery", async (ctx) => {
    if (!scratch) return ctx.skip();
    expect(await readSiteSettings(db)).toBeNull();
    await writeSiteSettings(db, { name: "Bakery", url: null, updatedById: "ana" });
    await writeSiteSettings(db, { name: "Bakery", url: "https://bakery.test", updatedById: "jo" });
    expect(await readSiteSettings(db)).toMatchObject({
      name: "Bakery",
      url: "https://bakery.test",
    });

    const hook = await createDeployHook(db, {
      name: "Rebuild",
      url: "https://hooks.test/1",
      secret: null,
    });
    await recordDeployHookDelivery(db, hook.id, { status: 500, error: "Server Error" });
    expect((await listDeployHooks(db))[0]).toMatchObject({
      lastStatus: 500,
      lastError: "Server Error",
    });
    expect(await deleteDeployHook(db, hook.id)).toBe(true);
    expect(await listDeployHooks(db)).toEqual([]);
  });
});
