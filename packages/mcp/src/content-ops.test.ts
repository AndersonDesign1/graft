/**
 * P6.5 — delete_content (destructive gate over MCP) + put_asset.
 *
 * delete_content must ride the exact P3.4 approval machinery: first call files
 * a pending approval and fails self-teachingly; only an approved, one-shot,
 * input-bound approval lets the retry delete the file and recompile. put_asset
 * is the remote-agent upload path (base64) and the stdio path (server-local
 * file), with an overwrite guard because the store keeps no history.
 *
 * Offline like cold-agent.test.ts: projection stubbed, in-memory approval
 * store, fake storage — no Neon, no R2.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Storage } from "@usegraft/assets";
import { ErrorCodes } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
import type { ApprovalStore, ChangeSet, Database } from "@usegraft/db";
import { projectBranchContent } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@usegraft/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/db")>();
  return {
    ...actual,
    projectBranchContent: vi.fn(
      async (_db: Database, rows: { collection: string; slug: string }[]): Promise<ChangeSet> => ({
        added: [],
        changed: [],
        removed: [],
        unchanged: rows.length,
      }),
    ),
  };
});

// Import after mock so createGraftMcp → compile sees the stubbed projection.
const { createGraftMcp } = await import("./server");

const collections = {
  pages: defineCollection({
    name: "pages",
    fields: { title: field.string() },
  }),
  submissions: defineCollection({
    name: "submissions",
    authority: "db-authoritative",
    fields: { email: field.string() },
  }),
};

/** In-memory ApprovalStore with the db store's exact refusal semantics. */
function memoryApprovals() {
  const rows = new Map<
    string,
    {
      functionName: string;
      inputCanonical: string;
      status: "pending" | "approved" | "denied" | "consumed";
    }
  >();
  let seq = 0;
  const requests: string[] = [];
  const store: ApprovalStore = {
    async request(req) {
      const id = `ap-${++seq}`;
      rows.set(id, {
        functionName: req.functionName,
        inputCanonical: req.inputCanonical,
        status: "pending",
      });
      requests.push(id);
      return id;
    },
    async consume(id, match) {
      const row = rows.get(id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status === "pending") return { ok: false, reason: "pending" };
      if (row.status === "denied") return { ok: false, reason: "denied" };
      if (row.status === "consumed") return { ok: false, reason: "already_consumed" };
      if (row.functionName !== match.functionName || row.inputCanonical !== match.inputCanonical) {
        return { ok: false, reason: "mismatch" };
      }
      row.status = "consumed";
      return { ok: true };
    },
  };
  return {
    store,
    requests,
    decide(id: string, status: "approved" | "denied") {
      const row = rows.get(id);
      if (!row) throw new Error(`no approval ${id}`);
      row.status = status;
    },
  };
}

/** Fake Storage recording puts; presign methods are never reached in these tests. */
function fakeStorage(preExisting: string[] = []) {
  const keys = new Set(preExisting);
  const puts: { key: string; bytes: number; contentType?: string }[] = [];
  const storage: Storage = {
    async put(key, body, contentType) {
      puts.push({
        key,
        bytes: typeof body === "string" ? body.length : body.byteLength,
        contentType,
      });
      keys.add(key);
    },
    async get() {
      throw new Error("not used");
    },
    async delete() {
      throw new Error("not used");
    },
    async exists(key) {
      return keys.has(key);
    },
    async presignPut() {
      throw new Error("not used");
    },
    async presignGet() {
      throw new Error("not used");
    },
    async url(key) {
      return `https://cdn.test/${key}`;
    },
  };
  return { storage, puts };
}

const stubDb = {} as Database;

let dir: string;
let client: Client;
let approvals: ReturnType<typeof memoryApprovals>;
let store: ReturnType<typeof fakeStorage>;

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return {
    isError: result.isError === true,
    payload: JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>,
  };
}

beforeEach(async () => {
  vi.mocked(projectBranchContent).mockClear();
  dir = mkdtempSync(join(tmpdir(), "graft-content-ops-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\n---\nWelcome");
  writeFileSync(join(dir, "pages", "keep.mdx"), "---\ntitle: Keep\n---\nStays");

  approvals = memoryApprovals();
  store = fakeStorage(["assets/taken.png"]);
  const server = createGraftMcp({
    contentDir: dir,
    collections,
    db: stubDb,
    audit: false,
    approvals: approvals.store,
    storage: store.storage,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("delete_content — the destructive gate over MCP", () => {
  it("files an approval and fails self-teachingly on the first call", async () => {
    const { isError, payload } = await callTool("delete_content", {
      collection: "pages",
      slug: "home",
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.DESTRUCTIVE_OP_REQUIRES_APPROVAL);
    const details = payload.details as { approvalId?: string };
    expect(details.approvalId).toBe("ap-1");
    expect(String(payload.fix)).toContain("graft approve");
    // The fix must speak MCP (the `approval` argument), not HTTP headers —
    // the P6.5 live cold agent flagged the header-speak as a dead end.
    expect(String(payload.fix)).toContain("`approval` argument");
    expect(String(payload.fix)).not.toContain("x-graft-approval");
    expect(String(payload.howToRecover)).toBeTruthy();
    // Nothing happened: file intact, projection never ran.
    expect(existsSync(join(dir, "pages", "home.mdx"))).toBe(true);
    expect(vi.mocked(projectBranchContent)).not.toHaveBeenCalled();
  });

  it("deletes the file and recompiles once the approval is consumed", async () => {
    const first = await callTool("delete_content", { collection: "pages", slug: "home" });
    const id = (first.payload.details as { approvalId: string }).approvalId;
    approvals.decide(id, "approved");

    const second = await callTool("delete_content", {
      collection: "pages",
      slug: "home",
      approval: id,
    });
    expect(second.isError).toBe(false);
    expect(second.payload.deleted).toBe("pages/home.mdx");
    expect(second.payload.branch).toBe("main");
    expect(second.payload.changes).toBeDefined();
    expect(second.payload.correlationId).toBeTruthy();
    expect(existsSync(join(dir, "pages", "home.mdx"))).toBe(false);
    expect(existsSync(join(dir, "pages", "keep.mdx"))).toBe(true);

    // The recompile projected the tree WITHOUT the deleted doc.
    const projected = vi.mocked(projectBranchContent).mock.calls.at(-1)?.[1] as {
      collection: string;
      slug: string;
    }[];
    expect(projected.map((r) => r.slug)).toEqual(["keep"]);
  });

  it("refuses a denied approval with the reason", async () => {
    const first = await callTool("delete_content", { collection: "pages", slug: "home" });
    const id = (first.payload.details as { approvalId: string }).approvalId;
    approvals.decide(id, "denied");

    const retry = await callTool("delete_content", {
      collection: "pages",
      slug: "home",
      approval: id,
    });
    expect(retry.isError).toBe(true);
    expect(retry.payload.error).toBe(ErrorCodes.APPROVAL_INVALID);
    expect((retry.payload.details as { reason: string }).reason).toBe("denied");
    expect(existsSync(join(dir, "pages", "home.mdx"))).toBe(true);
  });

  it("approvals are one-shot — a consumed id cannot delete again", async () => {
    const first = await callTool("delete_content", { collection: "pages", slug: "home" });
    const id = (first.payload.details as { approvalId: string }).approvalId;
    approvals.decide(id, "approved");
    await callTool("delete_content", { collection: "pages", slug: "home", approval: id });

    // Recreate the file and replay the same approval.
    writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\n---\nBack again");
    const replay = await callTool("delete_content", {
      collection: "pages",
      slug: "home",
      approval: id,
    });
    expect(replay.isError).toBe(true);
    expect(replay.payload.error).toBe(ErrorCodes.APPROVAL_INVALID);
    expect((replay.payload.details as { reason: string }).reason).toBe("already_consumed");
    expect(existsSync(join(dir, "pages", "home.mdx"))).toBe(true);
  });

  it("an approval is bound to its exact input — a different slug cannot ride it", async () => {
    const first = await callTool("delete_content", { collection: "pages", slug: "home" });
    const id = (first.payload.details as { approvalId: string }).approvalId;
    approvals.decide(id, "approved");

    const crossed = await callTool("delete_content", {
      collection: "pages",
      slug: "keep",
      approval: id,
    });
    expect(crossed.isError).toBe(true);
    expect(crossed.payload.error).toBe(ErrorCodes.APPROVAL_INVALID);
    expect((crossed.payload.details as { reason: string }).reason).toBe("mismatch");
    expect(existsSync(join(dir, "pages", "keep.mdx"))).toBe(true);
  });

  it("never files an approval for a document that does not exist", async () => {
    const { isError, payload } = await callTool("delete_content", {
      collection: "pages",
      slug: "ghost",
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.DOCUMENT_NOT_FOUND);
    expect(approvals.requests).toHaveLength(0);
  });

  it("rejects db-authoritative collections toward their typed functions", async () => {
    const { isError, payload } = await callTool("delete_content", {
      collection: "submissions",
      slug: "whatever",
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.AUTHORITY_MISMATCH);
    expect(String(payload.fix)).toMatch(/function/i);
    expect(approvals.requests).toHaveLength(0);
  });

  it("does not leak the internal delete function into function introspection", async () => {
    const listed = await callTool("list_functions");
    const fns = (listed.payload.functions ?? []) as { name: string }[];
    expect(fns.map((f) => f.name)).not.toContain("delete_content");

    const schema = await callTool("describe_schema");
    const schemaFns = (schema.payload.functions ?? []) as { name: string }[];
    expect(schemaFns.map((f) => f.name)).not.toContain("delete_content");
  });
});

describe("put_asset", () => {
  it("uploads a server-local file with a defaulted key and returns the reference", async () => {
    writeFileSync(join(dir, "Hero Image.PNG"), "not-really-png-bytes");
    const { isError, payload } = await callTool("put_asset", {
      path: join(dir, "Hero Image.PNG"),
    });
    expect(isError).toBe(false);
    expect(payload.key).toBe("assets/hero-image.png");
    expect(payload.contentType).toBe("image/png");
    expect(payload.bytes).toBeGreaterThan(0);
    expect(payload.url).toBe("https://cdn.test/assets/hero-image.png");
    expect(String(payload.frontmatter)).toContain("key: assets/hero-image.png");
    expect(store.puts).toHaveLength(1);
  });

  it("uploads base64 bytes under an explicit key", async () => {
    const bytes = Buffer.from("svg-ish content");
    const { isError, payload } = await callTool("put_asset", {
      key: "pages/pricing/hero.svg",
      base64: bytes.toString("base64"),
    });
    expect(isError).toBe(false);
    expect(payload.key).toBe("pages/pricing/hero.svg");
    expect(payload.contentType).toBe("image/svg+xml");
    expect(payload.bytes).toBe(bytes.byteLength);
    expect(store.puts[0]?.bytes).toBe(bytes.byteLength);
  });

  it("requires exactly one of path or base64", async () => {
    const neither = await callTool("put_asset", { key: "assets/x.png" });
    expect(neither.isError).toBe(true);
    expect(neither.payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);

    const both = await callTool("put_asset", {
      key: "assets/x.png",
      path: "x.png",
      base64: "aGk=",
    });
    expect(both.isError).toBe(true);
    expect(both.payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);
  });

  it("requires a key with base64", async () => {
    const { isError, payload } = await callTool("put_asset", { base64: "aGk=" });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);
    expect(String(payload.fix)).toContain("key");
  });

  it("rejects non-base64 input (the classic path-in-the-wrong-argument mistake)", async () => {
    const { isError, payload } = await callTool("put_asset", {
      key: "assets/x.png",
      base64: "C:/pictures/hero.png",
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);
    expect(String(payload.fix)).toContain("path");
  });

  it("rejects keys outside the asset-key alphabet", async () => {
    const { isError, payload } = await callTool("put_asset", {
      key: "Assets/Hero.png",
      base64: "aGk=",
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);
    expect(String(payload.fix)).toContain("lowercase");
  });

  it("refuses to overwrite an existing key unless overwrite: true", async () => {
    const refused = await callTool("put_asset", { key: "assets/taken.png", base64: "aGk=" });
    expect(refused.isError).toBe(true);
    expect(refused.payload.error).toBe(ErrorCodes.ASSET_EXISTS);
    expect(String(refused.payload.howToRecover)).toBeTruthy();
    expect(store.puts).toHaveLength(0);

    const replaced = await callTool("put_asset", {
      key: "assets/taken.png",
      base64: "aGk=",
      overwrite: true,
    });
    expect(replaced.isError).toBe(false);
    expect(store.puts).toHaveLength(1);
  });

  it("reports a missing server-local file as DOCUMENT_NOT_FOUND", async () => {
    const { isError, payload } = await callTool("put_asset", {
      path: join(dir, "nope.png"),
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.DOCUMENT_NOT_FOUND);
  });

  it("fails with ENV_VAR_MISSING when no storage is configured", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const name of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    try {
      const server = createGraftMcp({
        contentDir: dir,
        collections,
        db: stubDb,
        audit: false,
      });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const bare = new Client({ name: "test-agent-2", version: "0.0.0" });
      await bare.connect(ct);
      const result = (await bare.callTool({
        name: "put_asset",
        arguments: { key: "assets/x.png", base64: "aGk=" },
      })) as { isError?: boolean; content: { type: string; text: string }[] };
      const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
      expect(result.isError).toBe(true);
      expect(payload.error).toBe(ErrorCodes.ENV_VAR_MISSING);
      expect(String(payload.fix)).toContain("S3_ENDPOINT");
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value !== undefined) process.env[name] = value;
      }
    }
  });
});
