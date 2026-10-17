/**
 * Studio with no database: it edits the files, keeps the static index when
 * the project has one, and every view that needs Postgres answers
 * NEEDS_DATABASE with how to add one, instead of failing on a missing
 * connection.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import { openStaticIndex } from "@usegraft/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioApiHandler } from "../api";
import type { EntryDto, WorkspaceDto } from "../editor-types";
import type { ContentTree } from "../types";

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};
const ORIGIN = "http://localhost";

type Handler = ReturnType<typeof createStudioApiHandler>;

async function call<T>(
  handler: Handler,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const response = await handler(
    new Request(`${ORIGIN}/api/studio/v1${path}`, {
      method,
      headers: { "content-type": "application/json", origin: ORIGIN },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, json: (await response.json()) as T };
}

let root: string;
let contentDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "graft-studio-nodb-"));
  contentDir = join(root, "content");
  mkdirSync(join(contentDir, "pages"), { recursive: true });
  writeFileSync(join(contentDir, "pages", "about.mdx"), "---\ntitle: About\n---\n\nHello.\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "dev@example.com"],
    ["config", "user.name", "Dev"],
    ["add", "."],
    ["commit", "-q", "-m", "seed"],
  ]) {
    execFileSync("git", args, { cwd: root });
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function saveTitle(handler: Handler, title: string) {
  const opened = await call<EntryDto>(handler, "GET", "/entry?collection=pages&slug=about");
  return call<{ path: string; refresh?: unknown }>(handler, "PUT", "/entry", {
    collection: "pages",
    slug: "about",
    data: { ...opened.json.data, title },
    body: opened.json.body,
    baseVersion: opened.json.version,
  });
}

describe("Studio on the static index", () => {
  it("saves to the file and the static index, and reports index health from it", async () => {
    const indexPath = join(root, ".graft", "index.db");
    const handler = createStudioApiHandler({ collections, contentDir, staticIndexPath: indexPath });

    const workspace = await call<WorkspaceDto>(handler, "GET", "/workspace");
    expect(workspace.json).toMatchObject({ storage: "local", database: false, index: "static" });

    // Not compiled yet is a state, not an error.
    const before = await call<ContentTree>(handler, "GET", "/tree");
    expect(before.status).toBe(200);
    expect(before.json.index).toBe("static");
    expect(before.json.summary).toMatchObject({ documents: 1, unindexed: 1 });

    const saved = await saveTitle(handler, "About us");
    expect(saved.status).toBe(200);
    expect(readFileSync(join(contentDir, "pages", "about.mdx"), "utf8")).toContain(
      "title: About us",
    );
    const index = await openStaticIndex(indexPath);
    try {
      const [row] = await index.readContent({ collection: "pages", slug: "about" });
      expect(row?.data).toEqual({ title: "About us" });
    } finally {
      await index.close();
    }

    const after = await call<ContentTree>(handler, "GET", "/tree");
    expect(after.json.summary).toMatchObject({ documents: 1, synced: 1 });
    const compiled = await call<{ docCount: number }>(handler, "POST", "/compile", {});
    expect([compiled.status, compiled.json.docCount]).toEqual([200, 1]);
  });
});

describe("Studio with no index at all", () => {
  it("saves to the file, and says compiling needs an index", async () => {
    const handler = createStudioApiHandler({ collections, contentDir });
    const workspace = await call<WorkspaceDto>(handler, "GET", "/workspace");
    expect(workspace.json).toMatchObject({ database: false, index: "none" });

    const saved = await saveTitle(handler, "About us");
    expect(saved.status).toBe(200);
    expect(saved.json).not.toHaveProperty("refresh");
    expect(readFileSync(join(contentDir, "pages", "about.mdx"), "utf8")).toContain(
      "title: About us",
    );
    expect(existsSync(join(root, ".graft"))).toBe(false);

    const tree = await call<ContentTree>(handler, "GET", "/tree");
    expect([tree.status, tree.json.index]).toEqual([200, "none"]);
    const compiled = await call<{ error: string; fix: string }>(handler, "POST", "/compile", {});
    expect([compiled.status, compiled.json.error]).toEqual([503, "NEEDS_DATABASE"]);

    // Commit still works: it is Git, not the database.
    const committed = await call<{ commit: { sha: string } | null }>(
      handler,
      "POST",
      "/drafts/publish",
      { paths: ["pages/about.mdx"] },
    );
    expect(committed.json.commit?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("answers every view that needs Postgres with NEEDS_DATABASE and how to add one", async () => {
    const handler = createStudioApiHandler({ collections, contentDir });
    const answers: Record<string, [number, string, string]> = {};
    for (const path of [
      "/approvals",
      "/compilations",
      "/branches",
      "/agents",
      "/assets",
      "/site",
    ]) {
      const { status, json } = await call<{ error: string; message: string; fix: string }>(
        handler,
        "GET",
        path,
      );
      answers[path] = [status, json.error, json.message];
      expect(json.fix).toContain("DATABASE_URL");
    }
    expect(answers).toEqual({
      "/approvals": [
        503,
        "NEEDS_DATABASE",
        "Approvals are kept in Postgres, and this Studio runs without a database.",
      ],
      "/compilations": [
        503,
        "NEEDS_DATABASE",
        "The compile history is kept in Postgres, and this Studio runs without a database.",
      ],
      "/branches": [
        503,
        "NEEDS_DATABASE",
        "Branches are kept in Postgres, and this Studio runs without a database.",
      ],
      "/agents": [
        503,
        "NEEDS_DATABASE",
        "Agent tokens are kept in Postgres, and this Studio runs without a database.",
      ],
      "/assets": [
        503,
        "NEEDS_DATABASE",
        "The media library is kept in Postgres, and this Studio runs without a database.",
      ],
      "/site": [
        503,
        "NEEDS_DATABASE",
        "Site settings are kept in Postgres, and this Studio runs without a database.",
      ],
    });
  });

  it("refuses a media upload or delete before anything reaches the bucket", async () => {
    // A stand-in for the bucket that counts what reaches it.
    let requests = 0;
    const bucket = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200).end();
    });
    await new Promise<void>((resolve) => bucket.listen(0, "127.0.0.1", resolve));
    const address = bucket.address();
    const port = address && typeof address === "object" ? address.port : 0;
    vi.stubEnv("S3_ENDPOINT", `http://127.0.0.1:${port}`);
    vi.stubEnv("S3_ACCESS_KEY", "test");
    vi.stubEnv("S3_SECRET_KEY", "test");
    vi.stubEnv("S3_BUCKET", "test");
    try {
      const handler = createStudioApiHandler({ collections, contentDir });
      const upload = await call<{ error: string }>(handler, "POST", "/assets", {
        name: "hat.png",
        base64: Buffer.from("png").toString("base64"),
      });
      const removal = await call<{ error: string }>(handler, "DELETE", "/assets?key=hat.png");
      expect([upload.status, upload.json.error]).toEqual([503, "NEEDS_DATABASE"]);
      expect([removal.status, removal.json.error]).toEqual([503, "NEEDS_DATABASE"]);
      expect(requests).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      await new Promise((resolve) => bucket.close(resolve));
    }
  });
});
